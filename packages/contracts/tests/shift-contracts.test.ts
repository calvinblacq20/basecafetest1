import { describe, expect, it } from "vitest";

import {
  closeShiftRequestSchema,
  handoverShiftRequestSchema,
  openShiftRequestSchema,
} from "../src/shifts.js";

const branchId = "10000000-0000-4000-8000-000000000002";

describe("shift contracts", () => {
  it("accepts a client-generated shift ID and matching opening count", () => {
    expect(
      openShiftRequestSchema.safeParse({
        shiftId: "10000000-0000-4000-8000-000000000010",
        branchId,
        drawerKey: "TILL-1",
        openingFloatMinor: 15_000,
        denominations: [{ denominationMinor: 5_000, count: 3 }],
        reason: "Start service",
      }).success,
    ).toBe(true);
  });

  it("rejects mismatched denominations and negative money", () => {
    expect(
      openShiftRequestSchema.safeParse({
        shiftId: "10000000-0000-4000-8000-000000000010",
        branchId,
        openingFloatMinor: 10_000,
        denominations: [{ denominationMinor: 5_000, count: 1 }],
        reason: "Start service",
      }).success,
    ).toBe(false);
    expect(
      closeShiftRequestSchema.safeParse({
        branchId,
        revision: 1,
        countedCashMinor: -1,
        declaration: "Count complete",
        reason: "Close service",
      }).success,
    ).toBe(false);
  });

  it("requires revision, receiver, declaration, and reasons", () => {
    expect(
      handoverShiftRequestSchema.safeParse({
        branchId,
        revision: 1,
        receivingCashierId: "10000000-0000-4000-8000-000000000020",
        reason: "Shift change",
      }).success,
    ).toBe(true);
    expect(
      closeShiftRequestSchema.safeParse({
        branchId,
        revision: 1,
        countedCashMinor: 0,
        declaration: "",
        reason: "Close service",
      }).success,
    ).toBe(false);
  });
});
