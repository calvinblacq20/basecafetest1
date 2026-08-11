import { afterEach, describe, expect, it } from "vitest";

import type { PrismaService } from "../src/database/prisma.service.js";
import { LoginThrottleService } from "../src/auth/login-throttle.service.js";

afterEach(() => {
  delete process.env.AUTH_LOGIN_ACCOUNT_MAX_FAILURES;
  delete process.env.AUTH_THROTTLE_PEPPER;
});

type DimensionKey = { scope: string; keyHash: string };
type BucketWrite = DimensionKey & {
  failureCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
  lastFailedAt: Date;
};
type StoredBucket = BucketWrite & { createdAt: Date; updatedAt: Date };
type FindManyInput = {
  where: { OR: DimensionKey[]; lockedUntil: { gt: Date } };
};
type FindUniqueInput = { where: { scope_keyHash: DimensionKey } };
type UpsertInput = {
  where: { scope_keyHash: DimensionKey };
  create: BucketWrite;
  update: Partial<BucketWrite>;
};

describe("login throttle persistence", () => {
  it("updates all dimensions and audits the lock transition once", async () => {
    process.env.AUTH_LOGIN_ACCOUNT_MAX_FAILURES = "2";
    process.env.AUTH_THROTTLE_PEPPER =
      "a-secure-test-pepper-with-more-than-32-characters";
    const buckets = new Map<string, StoredBucket>();
    const audits: Array<{ data: Record<string, unknown> }> = [];
    const bucketKey = (scope: string, keyHash: string) => `${scope}:${keyHash}`;
    const client = {
      loginThrottleBucket: {
        findMany: async ({ where }: FindManyInput) =>
          [...buckets.values()].filter(
            (bucket) =>
              where.OR.some(
                ({ scope, keyHash }) =>
                  scope === bucket.scope && keyHash === bucket.keyHash,
              ) &&
              bucket.lockedUntil instanceof Date &&
              bucket.lockedUntil > where.lockedUntil.gt,
          ),
        findUnique: async ({ where }: FindUniqueInput) => {
          const key = where.scope_keyHash;
          return buckets.get(bucketKey(key.scope, key.keyHash)) ?? null;
        },
        upsert: async ({ where, create, update }: UpsertInput) => {
          const key = where.scope_keyHash;
          const mapKey = bucketKey(key.scope, key.keyHash);
          const existing = buckets.get(mapKey);
          const stored = {
            ...(existing ?? create),
            ...(existing ? update : {}),
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date(),
          };
          buckets.set(mapKey, stored);
          return stored;
        },
        updateMany: async () => ({ count: 0 }),
      },
      auditLog: {
        create: async (entry: { data: Record<string, unknown> }) => {
          audits.push(entry);
          return entry.data;
        },
      },
      $transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work(client),
    };
    const service = new LoginThrottleService(
      client as unknown as PrismaService,
    );
    const account = service.accountDimension(
      "organization-1",
      "a@example.test",
    );
    const device = service.deviceDimension("device-1");
    const ip = service.ipDimension("192.0.2.15");
    const dimensions = [account, device, ip];
    const audit = {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: "10000000-0000-4000-8000-000000000002",
      accountKeyHash: account.keyHash,
      deviceId: "device-1",
      deviceKeyHash: device.keyHash,
      ipKeyHash: ip.keyHash,
    };
    const started = new Date("2026-08-06T12:00:00.000Z");

    expect(await service.recordFailure(dimensions, audit, started)).toBeNull();
    const lock = await service.recordFailure(
      dimensions,
      audit,
      new Date(started.getTime() + 1_000),
    );

    expect(buckets.size).toBe(3);
    expect(lock?.scopes).toEqual(["ACCOUNT"]);
    expect(audits.map(({ data }) => data.action)).toEqual([
      "auth.login",
      "auth.login",
      "auth.login.locked",
    ]);
    expect(
      (audits[2]?.data.metadata as { lockedScopes: string[] }).lockedScopes,
    ).toEqual(["ACCOUNT"]);
  });
});
