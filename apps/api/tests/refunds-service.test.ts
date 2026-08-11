import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { RefundsService } from "../src/refunds/refunds.service.js";
const branchId = "10000000-0000-4000-8000-000000000001",
  userId = "10000000-0000-4000-8000-000000000002",
  refundId = "10000000-0000-4000-8000-000000000003";
const principal: AuthPrincipal = {
  userId,
  organizationId: "10000000-0000-4000-8000-000000000004",
  deviceId: "10000000-0000-4000-8000-000000000005",
  displayName: "Manager",
  email: "m@example.test",
  mustChangePassword: false,
  assignments: [
    { scope: "BRANCH", branchId, permissions: ["refunds.approve"] },
  ],
};
describe("refund service", () => {
  it("projects operational refund history without raw payment account fields", async () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: refundId,
        branchId,
        paymentId: "10000000-0000-4000-8000-000000000007",
        orderId: "10000000-0000-4000-8000-000000000008",
        shiftId: "10000000-0000-4000-8000-000000000009",
        requestedById: userId,
        resolvedById: null,
        kind: "REFUND",
        status: "AWAITING_APPROVAL",
        fiscalStatus: "NOT_REQUIRED",
        revision: 1,
        currency: "GHS",
        amountMinor: 300,
        evidenceNote: "Fictional evidence",
        providerReference: null,
        reason: "Fictional return",
        confirmedAt: null,
        failedAt: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
        requestedBy: { displayName: "Requesting cashier" },
        resolvedBy: null,
        approval: null,
        document: null,
        payment: {
          method: "CASH",
          amountMinor: 1_200,
          externalReference: "MUST-NOT-LEAK",
        },
        order: { orderNumber: "20260809-0001", grossTotalMinor: 1_200 },
      },
    ]);
    const service = new RefundsService({
      refund: { findMany },
    } as unknown as PrismaService);
    const response = await service.list(
      branchId,
      { limit: 50 },
      {
        ...principal,
        assignments: [
          { scope: "BRANCH", branchId, permissions: ["refunds.read"] },
        ],
      },
    );

    expect(response[0]).toMatchObject({
      id: refundId,
      requestedByDisplayName: "Requesting cashier",
      payment: { method: "CASH", amountMinor: 1_200 },
      document: null,
    });
    expect(JSON.stringify(response)).not.toContain("MUST-NOT-LEAK");
    expect(
      findMany.mock.calls[0]?.[0].include.payment.select,
    ).not.toHaveProperty("externalReference");
  });

  it("prevents a requester from approving their own refund", async () => {
    const client = {
      refund: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: refundId,
          revision: 1,
          status: "AWAITING_APPROVAL",
          requestedById: userId,
          payment: { method: "CASH", amountMinor: 1000 },
          order: { orderNumber: "O-1", receipt: null },
          approval: null,
        }),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (tx: object) => unknown) => work(client)),
    } as unknown as PrismaService;
    const error = await new RefundsService(prisma)
      .approve(
        refundId,
        {
          approvalId: "10000000-0000-4000-8000-000000000006",
          branchId,
          revision: 1,
          decision: "APPROVE",
          evidenceNote: "Checked",
          reason: "Manager review",
        },
        "refund-approval-key",
        principal,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
  });
});
