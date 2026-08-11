import { describe, expect, it } from "vitest";
import {
  approveCashMovementSchema,
  cashMovementResponseSchema,
  requestCashMovementSchema,
} from "../src/index.js";

const id = (value: number) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const request = {
  movementId: id(1),
  branchId: id(2),
  shiftId: id(3),
  shiftRevision: 2,
  type: "PAID_OUT" as const,
  direction: "OUT" as const,
  amountMinor: 500,
  evidenceNote: "Supplier receipt checked",
  reason: "Emergency ingredient purchase",
};

describe("cash movement contracts", () => {
  it("accepts explicit integer-pesewa paid-out requests", () => {
    expect(requestCashMovementSchema.parse(request).amountMinor).toBe(500);
  });

  it("rejects type and direction mismatches", () => {
    expect(
      requestCashMovementSchema.safeParse({ ...request, direction: "IN" })
        .success,
    ).toBe(false);
  });

  it("allows correction direction only when explicitly supplied", () => {
    expect(
      requestCashMovementSchema.safeParse({
        ...request,
        type: "CORRECTION",
        direction: "IN",
        correctsMovementId: id(9),
      }).success,
    ).toBe(true);
  });

  it("requires corrections to retain the posted movement reference", () => {
    expect(
      requestCashMovementSchema.safeParse({
        ...request,
        type: "CORRECTION",
        direction: "OUT",
      }).success,
    ).toBe(false);
  });

  it("requires an approval decision and evidence", () => {
    expect(
      approveCashMovementSchema.safeParse({
        approvalId: id(4),
        branchId: id(2),
        revision: 1,
        evidenceNote: "",
        reason: "Reviewed",
      }).success,
    ).toBe(false);
  });

  it("accepts the stable PII-safe operational response", () => {
    expect(
      cashMovementResponseSchema.parse({
        id: id(1),
        branchId: id(2),
        shiftId: id(3),
        requestedById: id(5),
        requestedByDisplayName: "Cashier",
        type: "PAID_IN",
        direction: "IN",
        status: "POSTED",
        revision: 2,
        currency: "GHS",
        amountMinor: 500,
        reference: null,
        evidenceNote: "Counted",
        reason: "Additional float",
        correctsMovement: null,
        approval: {
          id: id(6),
          approverId: id(7),
          approverDisplayName: "Reviewer",
          decision: "APPROVE",
          evidenceNote: "Recounted",
          reason: "Independent review",
          createdAt: "2026-08-09T10:01:00.000Z",
        },
        postedAt: "2026-08-09T10:01:00.000Z",
        rejectedAt: null,
        createdAt: "2026-08-09T10:00:00.000Z",
        updatedAt: "2026-08-09T10:01:00.000Z",
      }).status,
    ).toBe("POSTED");
  });
});
