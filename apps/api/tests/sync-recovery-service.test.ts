import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { SyncRecoveryService } from "../src/sync/sync-recovery.service.js";

const branchId = "00000000-0000-4000-8000-000000000001";
const commandId = "00000000-0000-4000-8000-000000000002";
const principal = (permissions: string[]): AuthPrincipal => ({
  userId: "00000000-0000-4000-8000-000000000003",
  organizationId: "00000000-0000-4000-8000-000000000004",
  deviceId: "00000000-0000-4000-8000-000000000005",
  displayName: "Manager",
  email: "manager@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});

describe("SyncRecoveryService", () => {
  it("enforces branch-scoped recovery permissions before persistence", async () => {
    const prisma = { syncCommandReceipt: { findMany: vi.fn() } };
    const service = new SyncRecoveryService(prisma as never);
    await expect(service.list(branchId, principal([]))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.syncCommandReceipt.findMany).not.toHaveBeenCalled();
  });

  it("appends one audited resolution without rewriting the command receipt", async () => {
    const transaction = {
      syncCommandReceipt: {
        findFirst: vi.fn().mockResolvedValue({
          commandId,
          branchId,
          deviceId: "00000000-0000-4000-8000-000000000005",
          aggregateId: "00000000-0000-4000-8000-000000000006",
          localSequence: 7n,
          status: "CONFLICT",
          resolution: null,
        }),
      },
      syncCommandResolution: {
        create: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000007",
          successorCommandId: null,
          resolvedAt: new Date("2026-08-07T12:00:00.000Z"),
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new SyncRecoveryService(prisma as never);

    await expect(
      service.resolve(
        commandId,
        {
          branchId,
          action: "ACKNOWLEDGED_NO_ACTION",
          successorCommandId: null,
          reason: "Verified the order already exists on the server.",
        },
        "offline-resolution-0001",
        principal(["sync.recovery.manage"]),
      ),
    ).resolves.toMatchObject({ action: "ACKNOWLEDGED_NO_ACTION", commandId });

    expect(transaction.syncCommandResolution.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });
});
