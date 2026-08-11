import { hash } from "@node-rs/argon2";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { MfaService } from "../src/auth/mfa.service.js";

describe("MFA service", () => {
  it("resets a stranded pending enrollment into audited retained history", async () => {
    const password = "correct horse battery staple";
    const transaction = {
      userMfaCredential: {
        update: vi.fn().mockResolvedValue({ revision: 2 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      userMfaCredential: {
        findFirst: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000010",
          status: "PENDING",
          revision: 1,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          passwordHash: await hash(password),
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
      displayName: "Fictional Owner",
      email: "owner@example.test",
      mustChangePassword: false,
      assignments: [],
    };

    const result = await new MfaService(prisma as never).resetPending(
      {
        currentPassword: password,
        revision: 1,
        reason: "Reset an incomplete authenticator enrollment.",
      },
      "mfa-reset-pending-command-0001",
      principal,
    );

    expect(result).toEqual({ disabled: true, revision: 2 });
    expect(transaction.userMfaCredential.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-4000-8000-000000000010" },
      data: {
        status: "DISABLED",
        disabledAt: expect.any(Date),
        revision: { increment: 1 },
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });
});
