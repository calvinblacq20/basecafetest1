import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { PaymentsService } from "../src/payments/payments.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const orderId = "10000000-0000-4000-8000-000000000005";
const paymentId = "10000000-0000-4000-8000-000000000006";
const shiftId = "10000000-0000-4000-8000-000000000007";

function principal(permissions: readonly string[], id = userId): AuthPrincipal {
  return {
    userId: id,
    organizationId,
    deviceId,
    displayName: "Cashier",
    email: "cashier@example.test",
    mustChangePassword: false,
    assignments: [{ scope: "BRANCH", branchId, permissions }],
  };
}

function transactional(client: object) {
  return {
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
      work(client),
    ),
  } as unknown as PrismaService;
}

describe("payment service controls", () => {
  it("returns a stable payment projection without provider/account fields", async () => {
    const payment = {
      id: paymentId,
      branchId,
      orderId,
      shiftId,
      deviceId,
      createdById: userId,
      createdBy: { displayName: "Fictional Cashier" },
      method: "MANUAL_MOMO",
      status: "REQUIRES_VERIFICATION",
      currency: "GHS",
      amountMinor: 1_000,
      tenderedAmountMinor: null,
      changeMinor: 0,
      externalReference: "FICTIONAL-REF",
      network: "must-not-leak",
      merchantAccountReference: "must-not-leak",
      evidenceNote: null,
      revision: 1,
      confirmedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: new Date("2026-08-09T10:00:00.000Z"),
      updatedAt: new Date("2026-08-09T10:00:00.000Z"),
      allocations: [],
      events: [],
      verification: null,
    };
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      payment: { findMany: vi.fn().mockResolvedValue([payment]) },
    } as unknown as PrismaService;
    const result = await new PaymentsService(prisma).list(
      branchId,
      { limit: 50 },
      principal(["payments.read"]),
    );

    expect(result[0]).toMatchObject({
      id: paymentId,
      createdByDisplayName: "Fictional Cashier",
      status: "REQUIRES_VERIFICATION",
    });
    expect(result[0]).not.toHaveProperty("network");
    expect(result[0]).not.toHaveProperty("merchantAccountReference");
    expect(result[0]).not.toHaveProperty("events");
  });

  it("rejects allocations above the confirmed outstanding balance", async () => {
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          status: "OPEN",
          currency: "GHS",
          grossTotalMinor: 2_000,
          mergesAsTarget: [],
        }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: orderId, grossTotalMinor: 2_000 }]),
      },
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({ id: shiftId, currency: "GHS" }),
      },
      paymentAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 1_500 } }),
      },
    };
    const failure = await new PaymentsService(transactional(client))
      .create(
        orderId,
        {
          paymentId,
          branchId,
          shiftId,
          method: "CASH",
          amountMinor: 1_000,
          tenderedAmountMinor: 1_000,
          allocations: [
            {
              allocationId: "10000000-0000-4000-8000-000000000008",
              orderId,
              amountMinor: 1_000,
            },
          ],
          reason: "Collect balance",
        },
        "payment-overage-0001",
        principal(["payments.create"]),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "PAYMENT_EXCEEDS_OUTSTANDING",
    });
  });

  it("requires a different authorized user to verify manual payment", async () => {
    const client = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: paymentId,
          orderId,
          createdById: userId,
          status: "REQUIRES_VERIFICATION",
          revision: 1,
          allocations: [{ orderId, amountMinor: 1_000 }],
        }),
      },
    };
    const failure = await new PaymentsService(transactional(client))
      .verify(
        paymentId,
        {
          verificationId: "10000000-0000-4000-8000-000000000009",
          branchId,
          revision: 1,
          decision: "CONFIRM",
          evidenceNote: "Matched merchant terminal reference",
          reason: "Independent verification",
        },
        "payment-verify-self-0001",
        principal(["payments.verify"]),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ForbiddenException);
    expect((failure as ForbiddenException).getResponse()).toMatchObject({
      code: "PAYMENT_SELF_VERIFICATION_FORBIDDEN",
    });
  });
});
