import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { SecurityOperationsService } from "../src/security-operations/security-operations.service.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";
const sessionId = "00000000-0000-4000-8000-000000000004";
const branchId = "00000000-0000-4000-8000-000000000005";

function principal(
  permissions: string[],
  scope: "ORGANIZATION" | "BRANCH" = "ORGANIZATION",
): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId,
    displayName: "Security Manager",
    email: "security@example.test",
    mustChangePassword: false,
    assignments: [
      { scope, branchId: scope === "BRANCH" ? branchId : null, permissions },
    ],
  };
}

describe("SecurityOperationsService", () => {
  it("requires organization-scoped session-management authority", async () => {
    const prisma = { idempotencyRecord: { findUnique: vi.fn() } };
    const service = new SecurityOperationsService(prisma as never, {} as never);
    await expect(
      service.revokeSession(
        sessionId,
        { revision: 1, reason: "Reviewed containment." },
        "security-session-revoke-0001",
        principal(["security.sessions.manage"], "BRANCH"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it("revokes exactly one session without returning its token hash", async () => {
    const transaction = {
      session: {
        findFirst: vi.fn().mockResolvedValue({
          id: sessionId,
          revision: 3,
          status: "ACTIVE",
          expiresAt: new Date("2099-08-09T12:00:00.000Z"),
          device: { branchId },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new SecurityOperationsService(prisma as never, {} as never);
    const result = await service.revokeSession(
      sessionId,
      { revision: 3, reason: "Reviewed containment." },
      "security-session-revoke-0002",
      principal(["security.sessions.manage"]),
    );
    expect(result).toMatchObject({
      id: sessionId,
      status: "REVOKED",
      revision: 4,
    });
    expect(JSON.stringify(result)).not.toContain("tokenHash");
    expect(transaction.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revokedById: userId,
          revocationReason: "Reviewed containment.",
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
  });
});
