import { describe, expect, it } from "vitest";
import {
  batchProductionPreviewResponseSchema,
  batchProductionResponseSchema,
  batchRecipeVersionResponseSchema,
  createBatchRecipeVersionSchema,
  createModifierRecipeEffectSchema,
  modifierRecipeEffectResponseSchema,
  reverseBatchProductionSchema,
} from "../src/inventory-production.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("inventory production contracts", () => {
  it("requires an explicit no-effect modifier version to have no components", () => {
    const result = createModifierRecipeEffectSchema.safeParse({
      effectVersionId: id(1),
      branchId: id(2),
      menuModifierId: id(3),
      affectsInventory: false,
      effectiveFrom: "2026-08-07T12:00:00.000Z",
      reason: "Declare modifier stock behavior",
      components: [
        { inventoryItemId: id(4), kind: "ADD", quantityMicros: "1000" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a direct batch self-reference and duplicate inputs", () => {
    const result = createBatchRecipeVersionSchema.safeParse({
      batchRecipeVersionId: id(1),
      branchId: id(2),
      outputInventoryItemId: id(3),
      yieldQuantityMicros: "1000000",
      effectiveFrom: "2026-08-07T12:00:00.000Z",
      reason: "Configure prep batch",
      components: [
        { inventoryItemId: id(3), quantityMicros: "500000" },
        { inventoryItemId: id(3), quantityMicros: "500000" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("defaults reversal negative-stock override to false", () => {
    const result = reverseBatchProductionSchema.parse({
      reversalId: id(1),
      branchId: id(2),
      productionRevision: 1,
      reason: "Reverse incorrect batch",
      ledgerEntries: [
        { originalLedgerEntryId: id(3), reversalLedgerEntryId: id(4) },
        { originalLedgerEntryId: id(5), reversalLedgerEntryId: id(6) },
      ],
    });
    expect(result.allowNegativeOverride).toBe(false);
  });

  it("validates a PII-minimized modifier stock-effect projection", () => {
    const effect = modifierRecipeEffectResponseSchema.parse({
      id: id(1),
      branchId: id(2),
      menuModifierId: id(3),
      version: 1,
      status: "ACTIVE",
      revision: 2,
      affectsInventory: true,
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      activatedAt: "2026-08-09T12:00:00.000Z",
      createdAt: "2026-08-09T11:00:00.000Z",
      updatedAt: "2026-08-09T12:00:00.000Z",
      menuModifier: { id: id(3), name: "Fictional oat milk" },
      components: [
        {
          inventoryItemId: id(4),
          kind: "ADD",
          quantityMicros: "100000",
          inventoryItem: { id: id(4), name: "Fictional ingredient" },
        },
      ],
    });
    expect(effect.components[0]?.kind).toBe("ADD");
    expect(effect).not.toHaveProperty("createdById");
    expect(effect).not.toHaveProperty("activatedById");
  });

  it("validates exact batch previews and retained production history", () => {
    const unit = {
      id: id(10),
      code: "EA",
      name: "Each",
      dimension: "COUNT" as const,
      isActive: true,
      revision: 1,
    };
    const outputItem = {
      id: id(11),
      branchId: id(2),
      baseUnitId: unit.id,
      externalKey: "FICTIONAL_SYRUP",
      name: "Fictional syrup",
      isActive: true,
      revision: 1,
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z",
      baseUnit: unit,
    };
    const inputItem = { ...outputItem, id: id(12), name: "Fictional cocoa" };
    const recipe = batchRecipeVersionResponseSchema.parse({
      id: id(13),
      branchId: id(2),
      outputInventoryItemId: outputItem.id,
      version: 1,
      status: "ACTIVE",
      revision: 2,
      yieldQuantityMicros: "1000000",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      activatedAt: "2026-08-09T11:00:00.000Z",
      createdAt: "2026-08-09T10:30:00.000Z",
      updatedAt: "2026-08-09T11:00:00.000Z",
      outputInventoryItem: outputItem,
      components: [
        {
          inventoryItemId: inputItem.id,
          quantityMicros: "500000",
          inventoryItem: inputItem,
        },
      ],
    });
    const preview = batchProductionPreviewResponseSchema.parse({
      configured: true,
      batchRecipeVersionId: recipe.id,
      batchRecipeVersion: recipe.version,
      outputInventoryItemId: outputItem.id,
      outputInventoryItemName: outputItem.name,
      outputLocationId: id(14),
      outputQuantityMicros: "1000000",
      occurredAt: "2026-08-09T12:00:00.000Z",
      inputs: [
        {
          inventoryItemId: inputItem.id,
          inventoryItemName: inputItem.name,
          locationId: id(14),
          quantityMicros: "500000",
        },
      ],
    });
    const production = batchProductionResponseSchema.parse({
      id: id(15),
      branchId: id(2),
      batchRecipeVersionId: recipe.id,
      outputInventoryItemId: outputItem.id,
      outputLocationId: id(14),
      outputQuantityMicros: "1000000",
      outputLedgerEntryId: id(16),
      revision: 2,
      negativeStockOverride: false,
      reason: "Produce fictional syrup",
      occurredAt: "2026-08-09T12:00:00.000Z",
      createdAt: "2026-08-09T12:00:00.000Z",
      actorDisplayName: "Development administrator",
      outputInventoryItem: { id: outputItem.id, name: outputItem.name },
      outputLocation: { id: id(14), name: "Fictional kitchen" },
      inputs: [
        {
          id: id(17),
          inventoryItemId: inputItem.id,
          locationId: id(14),
          quantityMicros: "500000",
          ledgerEntryId: id(18),
          inventoryItem: { id: inputItem.id, name: inputItem.name },
          location: { id: id(14), name: "Fictional kitchen" },
        },
      ],
      reversal: {
        id: id(19),
        reason: "Reverse fictional batch",
        createdAt: "2026-08-09T12:05:00.000Z",
        entries: [
          {
            id: id(20),
            originalLedgerEntryId: id(16),
            reversalLedgerEntryId: id(21),
          },
          {
            id: id(22),
            originalLedgerEntryId: id(18),
            reversalLedgerEntryId: id(23),
          },
        ],
      },
    });
    expect(preview.inputs[0]?.quantityMicros).toBe("500000");
    expect(production.reversal?.entries).toHaveLength(2);
    expect(recipe).not.toHaveProperty("createdById");
    expect(production).not.toHaveProperty("actorId");
  });
});
