import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { AuthService, offlineAccessPolicy } from "../src/auth/auth.service.js";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("offline access policy", () => {
  it("is disabled by default and never supplies an unlock lease", () => {
    delete process.env.OFFLINE_UNLOCK_ENABLED;
    expect(
      offlineAccessPolicy(
        new Date("2026-08-07T12:00:00.000Z"),
        new Date("2026-08-07T20:00:00.000Z"),
      ),
    ).toMatchObject({ enabled: false, leaseExpiresAt: null });
  });

  it("caps an enabled lease at the authenticated session expiry", () => {
    process.env.OFFLINE_UNLOCK_ENABLED = "true";
    process.env.OFFLINE_UNLOCK_MAX_MINUTES = "900";
    const policy = offlineAccessPolicy(
      new Date("2026-08-07T12:00:00.000Z"),
      new Date("2026-08-07T13:00:00.000Z"),
    );
    expect(policy.leaseExpiresAt).toBe("2026-08-07T13:00:00.000Z");
    expect(policy.minimumPinLength).toBeGreaterThanOrEqual(6);
  });
  it("requires a recent active device session and audits enrollment", async () => {
    process.env.OFFLINE_UNLOCK_ENABLED = "true";
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      session: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        }),
      },
      $transaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const principal: AuthPrincipal = {
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      deviceId: "00000000-0000-4000-8000-000000000003",
      displayName: "Cashier",
      email: "cashier@example.test",
      mustChangePassword: false,
      assignments: [],
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await expect(
      service.enrollOfflineUnlock(
        {
          branchId: "00000000-0000-4000-8000-000000000004",
          reason: "Enable bounded restart continuity.",
        },
        "offline-unlock-enrollment-0001",
        "x".repeat(32),
        principal,
      ),
    ).resolves.toMatchObject({ enabled: true });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });
});
