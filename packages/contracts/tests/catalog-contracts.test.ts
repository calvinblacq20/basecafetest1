import { describe, expect, it } from "vitest";

import {
  createMenuPriceRequestSchema,
  createModifierGroupRequestSchema,
  createStationRequestSchema,
  stationListResponseSchema,
} from "../src/index.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const menuItemId = "10000000-0000-4000-8000-000000000020";

describe("catalog command contracts", () => {
  it("requires an audit reason when creating a station", () => {
    expect(
      createStationRequestSchema.safeParse({
        branchId,
        name: "Fictional kitchen",
        kind: "KITCHEN",
      }).success,
    ).toBe(false);
    expect(
      createStationRequestSchema.safeParse({
        branchId,
        name: "Fictional kitchen",
        kind: "KITCHEN",
        reason: "Stage 3B contract verification",
      }).success,
    ).toBe(true);
  });

  it("rejects a required modifier group with no required selection", () => {
    const result = createModifierGroupRequestSchema.safeParse({
      branchId,
      name: "DEMO preparation",
      minimum: 0,
      maximum: 1,
      isRequired: true,
      modifiers: [{ name: "DEMO option" }],
      reason: "Contract verification.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects free selections above the group maximum", () => {
    const result = createModifierGroupRequestSchema.safeParse({
      branchId,
      name: "DEMO extras",
      maximum: 1,
      freeSelectionCount: 2,
      modifiers: [{ name: "DEMO extra" }],
      reason: "Contract verification.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects reversed effective price intervals", () => {
    const result = createMenuPriceRequestSchema.safeParse({
      branchId,
      menuItemId,
      amountMinor: 1_000,
      effectiveFrom: "2026-08-07T00:00:00.000Z",
      effectiveTo: "2026-08-06T00:00:00.000Z",
      reason: "Contract verification.",
    });
    expect(result.success).toBe(false);
  });

  it("parses stable station projections", () => {
    const now = "2026-08-09T12:00:00.000Z";
    expect(
      stationListResponseSchema.parse([
        {
          id: menuItemId,
          branchId,
          externalKey: "DEMO_KITCHEN",
          name: "Fictional kitchen",
          kind: "KITCHEN",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    ).toHaveLength(1);
  });
});
