import {
  refundListResponseSchema,
  refundResponseSchema,
} from "@base-cafe/contracts";
import { describe, expect, it } from "vitest";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const refund = {
  id: id(1),
  branchId: id(2),
  paymentId: id(3),
  orderId: id(4),
  shiftId: id(5),
  requestedById: id(6),
  requestedByDisplayName: "Requesting cashier",
  resolvedById: null,
  resolvedByDisplayName: null,
  kind: "REFUND",
  status: "AWAITING_APPROVAL",
  fiscalStatus: "NOT_REQUIRED",
  currency: "GHS",
  amountMinor: 500,
  evidenceNote: "Receipt inspected",
  providerReference: null,
  reason: "Fictional acceptance return",
  revision: 1,
  confirmedAt: null,
  failedAt: null,
  rejectedAt: null,
  createdAt: "2026-08-09T12:00:00.000Z",
  updatedAt: "2026-08-09T12:00:00.000Z",
  payment: { method: "CASH", amountMinor: 1_200 },
  order: { orderNumber: "20260809-0001", grossTotalMinor: 1_200 },
  approval: null,
  document: null,
} as const;

describe("refund operational contracts", () => {
  it("accepts the stable PII-safe lifecycle projection", () => {
    expect(refundResponseSchema.parse(refund)).toEqual(refund);
    expect(refundListResponseSchema.parse([refund])).toEqual([refund]);
  });

  it("requires an explicit non-fiscal document label", () => {
    expect(() =>
      refundResponseSchema.parse({
        ...refund,
        status: "CONFIRMED",
        document: {
          id: id(7),
          label: "FISCAL CREDIT NOTE",
          createdAt: "2026-08-09T12:02:00.000Z",
        },
      }),
    ).toThrow();
  });
});
