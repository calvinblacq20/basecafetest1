import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  OfflineUnlockEnrollmentRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { Prisma } from "@prisma/client";

import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  LoginThrottleService,
  type LoginThrottleDimension,
} from "./login-throttle.service.js";
import type { AuthPrincipal } from "./auth.types.js";
import { MfaService } from "./mfa.service.js";
import { createSessionToken, hashSessionToken } from "./token.js";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

export function offlineAccessPolicy(now: Date, sessionExpiresAt: Date) {
  const enabled = process.env.OFFLINE_UNLOCK_ENABLED === "true";
  const maximumMinutes = boundedInteger(
    process.env.OFFLINE_UNLOCK_MAX_MINUTES,
    240,
    15,
    1_440,
  );
  const leaseExpiresAt = enabled
    ? new Date(
        Math.min(
          sessionExpiresAt.getTime(),
          now.getTime() + maximumMinutes * 60_000,
        ),
      ).toISOString()
    : null;
  return {
    enabled,
    leaseExpiresAt,
    minimumPinLength: boundedInteger(
      process.env.OFFLINE_UNLOCK_MIN_PIN_LENGTH,
      6,
      6,
      12,
    ),
    maximumFailedAttempts: boundedInteger(
      process.env.OFFLINE_UNLOCK_MAX_FAILED_ATTEMPTS,
      5,
      3,
      10,
    ),
    lockoutSeconds: boundedInteger(
      process.env.OFFLINE_UNLOCK_LOCKOUT_SECONDS,
      300,
      30,
      86_400,
    ),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LoginThrottleService)
    private readonly loginThrottle: LoginThrottleService,
    @Inject(MfaService) private readonly mfaService: MfaService,
  ) {}

  async login(input: LoginRequest, ipAddress: string): Promise<LoginResponse> {
    const now = new Date();
    const email = input.email.trim().toLowerCase();
    const deviceDimension = this.loginThrottle.deviceDimension(input.deviceId);
    const ipDimension = this.loginThrottle.ipDimension(ipAddress);
    const perimeterDimensions = [deviceDimension, ipDimension] as const;
    const [device, perimeterLock] = await Promise.all([
      this.prisma.device.findFirst({
        where: { id: input.deviceId, status: "ACTIVE" },
      }),
      this.loginThrottle.activeLock(perimeterDimensions, now),
    ]);
    this.loginThrottle.throwIfLocked(perimeterLock, now);

    const accountDimension = this.loginThrottle.accountDimension(
      device?.organizationId ?? null,
      email,
    );
    const dimensions = [
      accountDimension,
      deviceDimension,
      ipDimension,
    ] as const;
    this.loginThrottle.throwIfLocked(
      await this.loginThrottle.activeLock([accountDimension], now),
      now,
    );

    const fingerprintMatches =
      device &&
      (!device.fingerprintHash ||
        device.fingerprintHash === input.deviceFingerprintHash?.toLowerCase());
    if (!device || !fingerprintMatches) {
      return this.rejectLogin(
        dimensions,
        device
          ? {
              organizationId: device.organizationId,
              branchId: device.branchId,
              accountKeyHash: accountDimension.keyHash,
              deviceId: input.deviceId,
              deviceKeyHash: deviceDimension.keyHash,
              ipKeyHash: ipDimension.keyHash,
            }
          : null,
        now,
      );
    }

    const activeDevice = device;
    const user = await this.prisma.user.findFirst({
      where: {
        organizationId: activeDevice.organizationId,
        email,
        status: "ACTIVE",
      },
      include: {
        mfaCredentials: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { activatedAt: "desc" },
        },
        roles: {
          where: { revokedAt: null },
          include: {
            role: { include: { permissions: true } },
          },
        },
      },
    });

    const validPassword = user
      ? await verify(user.passwordHash, input.password).catch(() => false)
      : false;

    if (!user || !validPassword) {
      return this.rejectLogin(
        dimensions,
        {
          organizationId: activeDevice.organizationId,
          branchId: activeDevice.branchId,
          actorId: user?.id,
          accountKeyHash: accountDimension.keyHash,
          deviceId: activeDevice.id,
          deviceKeyHash: deviceDimension.keyHash,
          ipKeyHash: ipDimension.keyHash,
        },
        now,
      );
    }

    const activeMfaCredential = user.mfaCredentials[0];
    const mfaActive = Boolean(activeMfaCredential);
    if (process.env.MFA_ENFORCEMENT_ENABLED === "true" && !mfaActive) {
      throw new UnauthorizedException({ code: "MFA_ENROLLMENT_REQUIRED" });
    }
    const mfaVerification = mfaActive
      ? await this.mfaService.verifyLoginCredential(activeMfaCredential!, input)
      : { valid: true, method: null, recoveryCodeId: undefined };
    if (!mfaVerification.valid) {
      return this.rejectLogin(
        dimensions,
        {
          organizationId: activeDevice.organizationId,
          branchId: activeDevice.branchId,
          actorId: user.id,
          accountKeyHash: accountDimension.keyHash,
          deviceId: activeDevice.id,
          deviceKeyHash: deviceDimension.keyHash,
          ipKeyHash: ipDimension.keyHash,
        },
        now,
      );
    }

    this.loginThrottle.throwIfLocked(
      await this.loginThrottle.activeLock(dimensions, now),
      now,
    );
    await this.loginThrottle.resetAccount(accountDimension, now);

    const configuredTtl = Number.parseInt(
      process.env.SESSION_TTL_MINUTES ?? "480",
      10,
    );
    const ttlMinutes = Number.isFinite(configuredTtl)
      ? Math.min(Math.max(configuredTtl, 5), 1_440)
      : 480;
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const accessToken = createSessionToken();

    await this.prisma.$transaction(async (transaction) => {
      if (mfaVerification.recoveryCodeId) {
        const consumed = await transaction.mfaRecoveryCode.updateMany({
          where: { id: mfaVerification.recoveryCodeId, usedAt: null },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException({ code: "MFA_RECOVERY_CODE_USED" });
        }
      }
      const session = await transaction.session.create({
        data: {
          userId: user.id,
          deviceId: activeDevice.id,
          tokenHash: hashSessionToken(accessToken),
          expiresAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          branchId: activeDevice.branchId,
          actorId: user.id,
          action: "auth.login",
          entityType: "session",
          entityId: session.id,
          metadata: {
            deviceId: activeDevice.id,
            ipKeyHash: ipDimension.keyHash,
            mfaMethod: mfaVerification.method,
          },
        },
      });
    });

    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) =>
          role.permissions.map(({ permissionKey }) => permissionKey),
        ),
      ),
    ].sort();

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      offlineAccess: offlineAccessPolicy(now, expiresAt),
      scope: {
        organizationId: user.organizationId,
        branchId: activeDevice.branchId,
        deviceId: activeDevice.id,
      },
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        permissions,
        mustChangePassword: user.mustChangePassword,
        mfaActive,
      },
    };
  }

  private async rejectLogin(
    dimensions: readonly LoginThrottleDimension[],
    audit: Parameters<LoginThrottleService["recordFailure"]>[1],
    now: Date,
  ): Promise<never> {
    const lock = await this.loginThrottle.recordFailure(dimensions, audit, now);
    this.loginThrottle.throwIfLocked(lock, now);
    throw new UnauthorizedException("Invalid credentials or device.");
  }

  async changePassword(
    input: ChangePasswordRequest,
    idempotencyKey: string,
    sessionToken: string,
    principal: AuthPrincipal,
  ) {
    const scope = "auth.password.change";
    const commandHash = requestHash({
      sessionToken,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== commandHash) {
        throw new ConflictException(
          "The idempotency key was already used with a different request.",
        );
      }
      return existing.responseBody;
    }

    const [user, currentSession] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: principal.userId } }),
      this.prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(sessionToken) },
      }),
    ]);
    if (!user || !currentSession || currentSession.userId !== user.id) {
      throw new UnauthorizedException("The session is invalid.");
    }
    const currentPasswordValid = await verify(
      user.passwordHash,
      input.currentPassword,
    ).catch(() => false);
    if (!currentPasswordValid) {
      throw new UnauthorizedException("The current password is incorrect.");
    }
    const passwordHash = await hash(input.newPassword, {
      algorithm: 2,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    });
    const response = { changed: true };

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.user.update({
            where: { id: user.id },
            data: {
              passwordHash,
              mustChangePassword: false,
              revision: { increment: 1 },
            },
          });
          const revoked = await transaction.session.updateMany({
            where: {
              userId: user.id,
              status: "ACTIVE",
              id: { not: currentSession.id },
            },
            data: {
              status: "REVOKED",
              revision: { increment: 1 },
              revokedById: principal.userId,
              revokedAt: new Date(),
              revocationReason: "Other sessions revoked after password change.",
            },
          });
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              actorId: principal.userId,
              action: scope,
              entityType: "user",
              entityId: principal.userId,
              metadata: {
                deviceId: principal.deviceId,
                otherSessionsRevoked: revoked.count,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
              requestHash: commandHash,
              responseBody: response,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "The password-change idempotency key already exists.",
        );
      }
      throw error;
    }
  }

  async enrollOfflineUnlock(
    input: OfflineUnlockEnrollmentRequest,
    idempotencyKey: string,
    token: string,
    principal: AuthPrincipal,
  ) {
    const scope = "auth.offline-unlock.enroll";
    const commandHash = requestHash({
      input,
      sessionTokenHash: hashSessionToken(token),
    });
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== commandHash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return prior.responseBody;
    }

    const session = await this.prisma.session.findFirst({
      where: {
        tokenHash: hashSessionToken(token),
        userId: principal.userId,
        deviceId: principal.deviceId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        device: {
          branchId: input.branchId,
          organizationId: principal.organizationId,
          status: "ACTIVE",
        },
      },
    });
    if (!session) throw new UnauthorizedException("The session is invalid.");
    if (Date.now() - session.createdAt.getTime() > 10 * 60_000)
      throw new ForbiddenException({
        code: "OFFLINE_UNLOCK_RECENT_LOGIN_REQUIRED",
      });
    const policy = offlineAccessPolicy(new Date(), session.expiresAt);
    if (!policy.enabled || !policy.leaseExpiresAt)
      throw new ForbiddenException({ code: "OFFLINE_UNLOCK_DISABLED" });

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            branchId: input.branchId,
            actorId: principal.userId,
            action: scope,
            entityType: "device",
            entityId: principal.deviceId,
            reason: input.reason,
            metadata: {
              deviceId: principal.deviceId,
              leaseExpiresAt: policy.leaseExpiresAt,
              minimumPinLength: policy.minimumPinLength,
            },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            aggregateType: "device",
            aggregateId: principal.deviceId,
            eventType: "auth.offline-unlock.enrolled",
            payload: {
              organizationId: principal.organizationId,
              branchId: input.branchId,
              deviceId: principal.deviceId,
              userId: principal.userId,
              leaseExpiresAt: policy.leaseExpiresAt,
            },
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            actorId: principal.userId,
            scope,
            key: idempotencyKey,
            requestHash: commandHash,
            responseBody: policy,
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          },
        });
        return policy;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async logout(token: string, principal: AuthPrincipal): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
      });
      if (!session || session.userId !== principal.userId) {
        throw new UnauthorizedException("The session is invalid.");
      }
      await transaction.session.update({
        where: { id: session.id },
        data: {
          status: "REVOKED",
          revision: { increment: 1 },
          revokedById: principal.userId,
          revokedAt: new Date(),
          revocationReason: "Staff signed out.",
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          actorId: principal.userId,
          action: "auth.logout",
          entityType: "session",
          entityId: session.id,
          metadata: { deviceId: principal.deviceId },
        },
      });
    });
  }
}
