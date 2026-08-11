import { describe, expect, it } from "vitest";
import {
  availabilityPreviewResponseSchema,
  createCriticalIngredientRuleSchema,
  recordManualAvailabilitySchema,
} from "../src/inventory-availability.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("inventory availability contracts", () => {
  it("rejects duplicate eligible locations for a critical ingredient", () => {
    const result = createCriticalIngredientRuleSchema.safeParse({
      ruleVersionId: id(1),
      branchId: id(2),
      menuItemId: id(3),
      recipeVersionId: id(4),
      effectiveFrom: "2026-08-07T12:00:00.000Z",
      reason: "Configure critical stock",
      components: [
        {
          inventoryItemId: id(5),
          safetyStockMicros: "0",
          locationIds: [id(6), id(6)],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires target identifiers to match the manual event kind", () => {
    const result = recordManualAvailabilitySchema.safeParse({
      eventId: id(1),
      branchId: id(2),
      targetKind: "VARIANT",
      menuVariantId: id(3),
      expectedRevision: 0,
      state: "UNAVAILABLE",
      effectiveFrom: "2026-08-07T12:00:00.000Z",
      reason: "Ingredient unavailable",
    });
    expect(result.success).toBe(false);
  });

  it("rejects expiry on a restore event", () => {
    const result = recordManualAvailabilitySchema.safeParse({
      eventId: id(1),
      branchId: id(2),
      targetKind: "ITEM",
      menuItemId: id(3),
      expectedRevision: 1,
      state: "RESTORED",
      effectiveFrom: "2026-08-07T12:00:00.000Z",
      expiresAt: "2026-08-08T12:00:00.000Z",
      reason: "Ingredient replenished",
    });
    expect(result.success).toBe(false);
  });

  it("parses exact-micro availability previews", () => {
    const parsed = availabilityPreviewResponseSchema.parse({
      configured: false,
      available: true,
      issueCode: "STOCK_AVAILABILITY_POLICY_NOT_CONFIGURED",
      at: "2026-08-10T00:00:00.000Z",
      quantity: 1,
      menuItemId: id(3),
      menuVariantId: null,
      manualEventId: null,
      components: [],
    });
    expect(parsed.issueCode).toBe("STOCK_AVAILABILITY_POLICY_NOT_CONFIGURED");
  });
});
