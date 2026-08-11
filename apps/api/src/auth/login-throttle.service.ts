import { createHmac } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  Prisma,
  type LoginThrottleBucket,
  type LoginThrottleScope,
} from "@prisma/client";

import { PrismaService } from "../database/prisma.service.js";
import {
  loadLoginThrottlePolicy,
  nextLoginThrottleState,
  retryAfterSeconds,
  type LoginThrottlePolicy,
  type LoginThrottleScopeName,
} from "./login-throttle.policy.js";

export type LoginThrottleDimension = Readonly<{
  scope: LoginThrottleScopeName;
  keyHash: string;
}>;

type LoginAuditContext = Readonly<{
  organizationId: string;
  branchId: string;
  actorId?: string;
  accountKeyHash: string;
  deviceId: string;
  deviceKeyHash: string;
  ipKeyHash: string;
}>;

type ActiveLock = Readonly<{
  scopes: LoginThrottleScopeName[];
  lockedUntil: Date;
}>;

export class LoginThrottledException extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(seconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: "Too Many Requests",
        message: "Too many login attempts. Try again later.",
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfterSeconds = seconds;
  }
}

function throttlePepper(): string {
  const configured = process.env.AUTH_THROTTLE_PEPPER?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_THROTTLE_PEPPER must contain at least 32 characters in production.",
    );
  }
  return "BASE_CAFE_DEVELOPMENT_ONLY_THROTTLE_PEPPER_CHANGE_ME";
}

@Injectable()
export class LoginThrottleService {
  private readonly policy: LoginThrottlePolicy;
  private readonly pepper: string;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.policy = loadLoginThrottlePolicy();
    this.pepper = throttlePepper();
  }

  accountDimension(
    organizationId: string | null,
    normalizedEmail: string,
  ): LoginThrottleDimension {
    return this.dimension(
      "ACCOUNT",
      `${organizationId ?? "UNKNOWN_ORGANIZATION"}:${normalizedEmail}`,
    );
  }

  deviceDimension(deviceId: string): LoginThrottleDimension {
    return this.dimension("DEVICE", deviceId.toLowerCase());
  }

  ipDimension(ipAddress: string): LoginThrottleDimension {
    const normalized = ipAddress
      .trim()
      .toLowerCase()
      .replace(/^::ffff:/, "");
    return this.dimension("IP", normalized || "unavailable");
  }

  async activeLock(
    dimensions: readonly LoginThrottleDimension[],
    now = new Date(),
  ): Promise<ActiveLock | null> {
    const buckets = await this.prisma.loginThrottleBucket.findMany({
      where: {
        OR: dimensions.map(({ scope, keyHash }) => ({ scope, keyHash })),
        lockedUntil: { gt: now },
      },
    });
    return this.toActiveLock(buckets, now);
  }

  throwIfLocked(lock: ActiveLock | null, now = new Date()): void {
    if (lock) {
      throw new LoginThrottledException(
        retryAfterSeconds(lock.lockedUntil, now),
      );
    }
  }

  async recordFailure(
    dimensions: readonly LoginThrottleDimension[],
    audit: LoginAuditContext | null,
    now = new Date(),
  ): Promise<ActiveLock | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const locked: LoginThrottleBucket[] = [];
            const newlyLockedScopes = new Set<LoginThrottleScopeName>();
            for (const dimension of dimensions) {
              const current = await transaction.loginThrottleBucket.findUnique({
                where: {
                  scope_keyHash: {
                    scope: dimension.scope,
                    keyHash: dimension.keyHash,
                  },
                },
              });
              const state = nextLoginThrottleState(
                current,
                now,
                this.policy.failureLimits[dimension.scope],
                this.policy,
              );
              const bucket = await transaction.loginThrottleBucket.upsert({
                where: {
                  scope_keyHash: {
                    scope: dimension.scope,
                    keyHash: dimension.keyHash,
                  },
                },
                create: {
                  scope: dimension.scope,
                  keyHash: dimension.keyHash,
                  failureCount: state.failureCount,
                  windowStartedAt: state.windowStartedAt,
                  lockedUntil: state.lockedUntil,
                  lastFailedAt: now,
                },
                update: {
                  failureCount: state.failureCount,
                  windowStartedAt: state.windowStartedAt,
                  lockedUntil: state.lockedUntil,
                  lastFailedAt: now,
                },
              });
              if (bucket.lockedUntil && bucket.lockedUntil > now) {
                locked.push(bucket);
                const wasAlreadyLocked =
                  current?.lockedUntil !== null &&
                  current?.lockedUntil !== undefined &&
                  current.lockedUntil > now;
                if (!wasAlreadyLocked) newlyLockedScopes.add(bucket.scope);
              }
            }

            if (audit) {
              await transaction.auditLog.create({
                data: {
                  organizationId: audit.organizationId,
                  branchId: audit.branchId,
                  actorId: audit.actorId,
                  action: "auth.login",
                  entityType: "authentication_subject",
                  entityId: audit.accountKeyHash,
                  outcome: "DENIED",
                  reason: "Invalid credentials or device",
                  metadata: {
                    deviceId: audit.deviceId,
                    deviceKeyHash: audit.deviceKeyHash,
                    ipKeyHash: audit.ipKeyHash,
                  },
                },
              });
              const newlyLocked = locked.filter(({ scope }) =>
                newlyLockedScopes.has(scope),
              );
              if (newlyLocked.length > 0) {
                await transaction.auditLog.create({
                  data: {
                    organizationId: audit.organizationId,
                    branchId: audit.branchId,
                    actorId: audit.actorId,
                    action: "auth.login.locked",
                    entityType: "authentication_subject",
                    entityId: audit.accountKeyHash,
                    outcome: "DENIED",
                    reason: "Login failure threshold reached",
                    metadata: {
                      deviceId: audit.deviceId,
                      deviceKeyHash: audit.deviceKeyHash,
                      ipKeyHash: audit.ipKeyHash,
                      lockedScopes: newlyLocked.map(({ scope }) => scope),
                      lockedUntil: new Date(
                        Math.max(
                          ...newlyLocked.map(({ lockedUntil }) =>
                            (lockedUntil as Date).getTime(),
                          ),
                        ),
                      ).toISOString(),
                    },
                  },
                });
              }
            }
            return this.toActiveLock(locked, now);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2002" || error.code === "P2034");
        if (!retryable || attempt === 3) throw error;
      }
    }
    return null;
  }

  async resetAccount(
    dimension: LoginThrottleDimension,
    now = new Date(),
  ): Promise<void> {
    if (dimension.scope !== "ACCOUNT") {
      throw new Error("Only an account throttle bucket can be reset on login.");
    }
    await this.prisma.loginThrottleBucket.updateMany({
      where: { scope: dimension.scope, keyHash: dimension.keyHash },
      data: {
        failureCount: 0,
        windowStartedAt: now,
        lockedUntil: null,
      },
    });
  }

  private dimension(
    scope: LoginThrottleScopeName,
    subject: string,
  ): LoginThrottleDimension {
    return {
      scope,
      keyHash: createHmac("sha256", this.pepper)
        .update(`${scope}:${subject}`)
        .digest("hex"),
    };
  }

  private toActiveLock(
    buckets: readonly Pick<LoginThrottleBucket, "scope" | "lockedUntil">[],
    now: Date,
  ): ActiveLock | null {
    const active = buckets.filter(
      (bucket) => bucket.lockedUntil && bucket.lockedUntil > now,
    );
    if (active.length === 0) return null;
    return {
      scopes: [
        ...new Set(active.map(({ scope }) => scope as LoginThrottleScope)),
      ],
      lockedUntil: new Date(
        Math.max(
          ...active.map(({ lockedUntil }) => (lockedUntil as Date).getTime()),
        ),
      ),
    };
  }
}
