import { describe, expect, it } from "vitest";
import {
  createRecipeVersionSchema,
  createStockCountSchema,
  inventoryItemResponseSchema,
  inventoryTransferResponseSchema,
  inventoryUnitResponseSchema,
  postInventoryTransferSchema,
  postStockAdjustmentSchema,
  recipeVersionResponseSchema,
  stockCountResponseSchema,
} from "../src/inventory.js";

const ids = {
  branch: "10000000-0000-4000-8000-000000000001",
  item: "10000000-0000-4000-8000-000000000002",
  item2: "10000000-0000-4000-8000-000000000003",
  location: "10000000-0000-4000-8000-000000000004",
  location2: "10000000-0000-4000-8000-000000000005",
  command: "10000000-0000-4000-8000-000000000006",
  menu: "10000000-0000-4000-8000-000000000007",
};

describe("inventory contracts", () => {
  it("keeps exact quantities as bounded integer-micro strings", () => {
    expect(
      postStockAdjustmentSchema.safeParse({
        ledgerEntryId: ids.command,
        branchId: ids.branch,
        locationId: ids.location,
        inventoryItemId: ids.item,
        type: "WASTE",
        quantityDeltaMicros: "-125000",
        reason: "Spoilage recorded",
      }).success,
    ).toBe(true);
    expect(
      postStockAdjustmentSchema.safeParse({
        ledgerEntryId: ids.command,
        branchId: ids.branch,
        locationId: ids.location,
        inventoryItemId: ids.item,
        type: "WASTE",
        quantityDeltaMicros: "1.25",
        reason: "Spoilage recorded",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate recipe and count item rows", () => {
    const recipe = createRecipeVersionSchema.safeParse({
      recipeVersionId: ids.command,
      branchId: ids.branch,
      menuItemId: ids.menu,
      yieldQuantityMicros: "1000000",
      effectiveFrom: "2026-08-07T00:00:00.000Z",
      reason: "Initial draft recipe",
      components: [
        { inventoryItemId: ids.item, quantityMicros: "100000" },
        { inventoryItemId: ids.item, quantityMicros: "200000" },
      ],
    });
    const count = createStockCountSchema.safeParse({
      stockCountId: ids.command,
      branchId: ids.branch,
      locationId: ids.location,
      reason: "End of day count",
      lines: [
        { inventoryItemId: ids.item2, countedQuantityMicros: "0" },
        { inventoryItemId: ids.item2, countedQuantityMicros: "1" },
      ],
    });
    expect(recipe.success).toBe(false);
    expect(count.success).toBe(false);
  });

  it("requires different locations for a transfer", () => {
    expect(
      postInventoryTransferSchema.safeParse({
        transferId: ids.command,
        outboundEntryId: ids.item,
        inboundEntryId: ids.item2,
        branchId: ids.branch,
        inventoryItemId: ids.menu,
        fromLocationId: ids.location,
        toLocationId: ids.location,
        quantityMicros: "1000000",
        reason: "Move stock to bar",
      }).success,
    ).toBe(false);
  });

  it("validates PII-minimized inventory records and BigInt-safe quantities", () => {
    const unit = inventoryUnitResponseSchema.parse({
      id: ids.command,
      code: "ML",
      name: "Millilitre",
      dimension: "VOLUME",
      isActive: true,
      revision: 1,
      createdAt: "2026-08-09T12:00:00.000Z",
      updatedAt: "2026-08-09T12:00:00.000Z",
      conversionsFrom: [],
    });
    expect(
      inventoryItemResponseSchema.parse({
        id: ids.item,
        branchId: ids.branch,
        baseUnitId: unit.id,
        externalKey: "FICTIONAL_MILK",
        name: "Fictional milk",
        isActive: true,
        revision: 1,
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
        baseUnit: unit,
      }).baseUnit.code,
    ).toBe("ML");
    expect(unit).not.toHaveProperty("organizationId");
  });

  it("validates recipe snapshots without configuration actor identifiers", () => {
    const unit = {
      id: ids.command,
      code: "EA",
      name: "Each",
      dimension: "COUNT" as const,
      isActive: true,
      revision: 1,
    };
    const recipe = recipeVersionResponseSchema.parse({
      id: ids.location,
      branchId: ids.branch,
      menuItemId: ids.menu,
      menuVariantId: null,
      version: 1,
      status: "ACTIVE",
      revision: 2,
      yieldQuantityMicros: "1000000",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      activatedAt: "2026-08-09T12:00:00.000Z",
      createdAt: "2026-08-09T11:00:00.000Z",
      updatedAt: "2026-08-09T12:00:00.000Z",
      menuItem: { id: ids.menu, name: "Fictional cocoa" },
      menuVariant: null,
      components: [
        {
          inventoryItemId: ids.item,
          quantityMicros: "250000",
          inventoryItem: {
            id: ids.item,
            branchId: ids.branch,
            baseUnitId: unit.id,
            externalKey: "FICTIONAL_COCOA",
            name: "Fictional cocoa ingredient",
            isActive: true,
            revision: 1,
            createdAt: "2026-08-09T10:00:00.000Z",
            updatedAt: "2026-08-09T10:00:00.000Z",
            baseUnit: unit,
          },
        },
      ],
    });
    expect(recipe.components[0]?.quantityMicros).toBe("250000");
    expect(recipe).not.toHaveProperty("createdById");
    expect(recipe).not.toHaveProperty("activatedById");
  });

  it("validates retained transfer and stock-count projections without actor IDs", () => {
    const unit = {
      id: ids.command,
      code: "EA",
      name: "Each",
      dimension: "COUNT" as const,
      isActive: true,
      revision: 1,
    };
    const item = {
      id: ids.item,
      branchId: ids.branch,
      baseUnitId: unit.id,
      externalKey: "FICTIONAL_COCOA",
      name: "Fictional cocoa ingredient",
      isActive: true,
      revision: 1,
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z",
      baseUnit: unit,
    };
    const transfer = inventoryTransferResponseSchema.parse({
      id: ids.location2,
      branchId: ids.branch,
      inventoryItemId: item.id,
      fromLocationId: ids.location,
      toLocationId: ids.location2,
      quantityMicros: "1000000",
      reason: "Move fictional stock",
      createdAt: "2026-08-09T11:00:00.000Z",
      inventoryItem: item,
      fromLocation: { id: ids.location, name: "Fictional store" },
      toLocation: { id: ids.location2, name: "Fictional kitchen" },
      actorDisplayName: "Development administrator",
    });
    const count = stockCountResponseSchema.parse({
      id: ids.item2,
      branchId: ids.branch,
      locationId: ids.location2,
      status: "POSTED",
      revision: 2,
      reason: "Count fictional kitchen stock",
      postedAt: "2026-08-09T12:00:00.000Z",
      createdAt: "2026-08-09T11:30:00.000Z",
      updatedAt: "2026-08-09T12:00:00.000Z",
      location: { id: ids.location2, name: "Fictional kitchen" },
      createdByDisplayName: "Development administrator",
      postedByDisplayName: "Development administrator",
      lines: [
        {
          inventoryItemId: item.id,
          countedQuantityMicros: "900000",
          inventoryItem: item,
        },
      ],
    });
    expect(transfer.quantityMicros).toBe("1000000");
    expect(count.lines[0]?.countedQuantityMicros).toBe("900000");
    expect(transfer).not.toHaveProperty("actorId");
    expect(count).not.toHaveProperty("createdById");
    expect(count).not.toHaveProperty("postedById");
  });
});
