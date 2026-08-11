import { describe, expect, it } from "vitest";

import {
  completeOrderResponseSchema,
  createPaymentRequestSchema,
  paymentListQuerySchema,
  paymentResponseSchema,
  verifyManualPaymentRequestSchema,
} from "../src/index.js";

const ids = {
  paymentId: "10000000-0000-4000-8000-000000000001",
  branchId: "10000000-0000-4000-8000-000000000002",
  shiftId: "10000000-0000-4000-8000-000000000003",
  orderId: "10000000-0000-4000-8000-000000000004",
  allocationId: "10000000-0000-4000-8000-000000000005",
};

const base = {
  paymentId: ids.paymentId,
  branchId: ids.branchId,
  shiftId: ids.shiftId,
  amountMinor: 2_500,
  allocations: [
    {
      allocationId: ids.allocationId,
      orderId: ids.orderId,
      amountMinor: 2_500,
    },
  ],
  reason: "Customer tendered payment",
};

describe("payment contracts", () => {
  it("parses the bounded completion response consumed by the POS", () => {
    const response = completeOrderResponseSchema.parse({
      orderId: ids.orderId,
      status: "COMPLETED",
      revision: 4,
      completedAt: "2026-08-09T10:00:00.000Z",
      confirmedTotalMinor: 2_500,
      compositionOrderIds: [ids.orderId],
      inventory: { status: "SKIPPED" },
    });
    expect(response.status).toBe("COMPLETED");
  });

  it("accepts cash and records deterministic change input", () => {
    const payment = createPaymentRequestSchema.parse({
      ...base,
      method: "CASH",
      tenderedAmountMinor: 3_000,
    });
    expect(payment.tenderedAmountMinor).toBe(3_000);
  });

  it("requires references for manual non-cash tenders", () => {
    expect(
      createPaymentRequestSchema.safeParse({ ...base, method: "MANUAL_MOMO" })
        .success,
    ).toBe(false);
    expect(
      createPaymentRequestSchema.parse({
        ...base,
        method: "MANUAL_MOMO",
        externalReference: "MOMO-001",
      }).externalReference,
    ).toBe("MOMO-001");
  });

  it("rejects allocation drift and duplicate order allocations", () => {
    expect(
      createPaymentRequestSchema.safeParse({
        ...base,
        method: "CASH",
        tenderedAmountMinor: 3_000,
        allocations: [{ ...base.allocations[0], amountMinor: 2_499 }],
      }).success,
    ).toBe(false);
    expect(
      createPaymentRequestSchema.safeParse({
        ...base,
        method: "CASH",
        tenderedAmountMinor: 3_000,
        allocations: [
          { ...base.allocations[0], amountMinor: 1_000 },
          {
            allocationId: "10000000-0000-4000-8000-000000000006",
            orderId: ids.orderId,
            amountMinor: 1_500,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires explicit evidence for independent verification", () => {
    expect(
      verifyManualPaymentRequestSchema.safeParse({
        verificationId: ids.allocationId,
        branchId: ids.branchId,
        revision: 1,
        decision: "CONFIRM",
        evidenceNote: "",
        reason: "Checked merchant terminal",
      }).success,
    ).toBe(false);
  });

  it("bounds payment list queries", () => {
    expect(paymentListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(paymentListQuerySchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
  });

  it("parses the stable POS-safe payment projection", () => {
    const response = paymentResponseSchema.parse({
      id: ids.paymentId,
      branchId: ids.branchId,
      orderId: ids.orderId,
      shiftId: ids.shiftId,
      createdById: ids.allocationId,
      createdByDisplayName: "Fictional Cashier",
      method: "MANUAL_MOMO",
      status: "REQUIRES_VERIFICATION",
      currency: "GHS",
      amountMinor: 2_500,
      tenderedAmountMinor: null,
      changeMinor: 0,
      externalReference: "TEST-REF-001",
      evidenceNote: null,
      revision: 1,
      confirmedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-09T10:00:00.000Z",
      allocations: [
        {
          id: ids.allocationId,
          orderId: ids.orderId,
          amountMinor: 2_500,
          order: { orderNumber: "20260809-0001", grossTotalMinor: 2_500 },
        },
      ],
      verification: null,
    });
    expect(response.status).toBe("REQUIRES_VERIFICATION");
    expect(response).not.toHaveProperty("merchantAccountReference");
    expect(response).not.toHaveProperty("network");
  });
});
