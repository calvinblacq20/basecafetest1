import { z } from "zod";
import {
  inventoryItemResponseSchema,
  positiveInventoryQuantityMicrosSchema,
  recipeStatusSchema,
} from "./inventory.js";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

export const modifierInventoryEffectKindSchema = z.enum([
  "ADD",
  "REMOVE",
  "REPLACE_ADD",
  "REPLACE_REMOVE",
]);

export const createModifierRecipeEffectSchema = z
  .object({
    effectVersionId: id,
    branchId: id,
    menuModifierId: id,
    affectsInventory: z.boolean(),
    effectiveFrom: z.string().datetime(),
    components: z
      .array(
        z.object({
          inventoryItemId: id,
          kind: modifierInventoryEffectKindSchema,
          quantityMicros: positiveInventoryQuantityMicrosSchema,
        }),
      )
      .max(100),
    reason,
  })
  .superRefine((value, context) => {
    if (value.affectsInventory !== value.components.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message:
          "Inventory-affecting modifiers require components; explicit no-effect versions require none.",
      });
    }
    const keys = value.components.map(
      (component) => `${component.inventoryItemId}:${component.kind}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Modifier effect components must be unique by item and kind.",
      });
    }
  });
export type CreateModifierRecipeEffect = z.infer<
  typeof createModifierRecipeEffectSchema
>;

export const activateModifierRecipeEffectSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type ActivateModifierRecipeEffect = z.infer<
  typeof activateModifierRecipeEffectSchema
>;

export const modifierRecipeEffectResponseSchema = z.object({
  id,
  branchId: id,
  menuModifierId: id,
  version: z.number().int().positive(),
  status: recipeStatusSchema,
  revision: z.number().int().positive(),
  affectsInventory: z.boolean(),
  effectiveFrom: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  menuModifier: z.object({ id, name: z.string().min(1).max(160) }),
  components: z.array(
    z.object({
      inventoryItemId: id,
      kind: modifierInventoryEffectKindSchema,
      quantityMicros: positiveInventoryQuantityMicrosSchema,
      inventoryItem: z.object({ id, name: z.string().min(1).max(160) }),
    }),
  ),
});
export const modifierRecipeEffectListResponseSchema = z.array(
  modifierRecipeEffectResponseSchema,
);
export type ModifierRecipeEffectResponse = z.infer<
  typeof modifierRecipeEffectResponseSchema
>;

export const createBatchRecipeVersionSchema = z
  .object({
    batchRecipeVersionId: id,
    branchId: id,
    outputInventoryItemId: id,
    yieldQuantityMicros: positiveInventoryQuantityMicrosSchema,
    effectiveFrom: z.string().datetime(),
    components: z
      .array(
        z.object({
          inventoryItemId: id,
          quantityMicros: positiveInventoryQuantityMicrosSchema,
        }),
      )
      .min(1)
      .max(100),
    reason,
  })
  .superRefine((value, context) => {
    const ids = value.components.map((component) => component.inventoryItemId);
    if (
      new Set(ids).size !== ids.length ||
      ids.includes(value.outputInventoryItemId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message:
          "Batch inputs must be unique and cannot directly contain the output item.",
      });
    }
  });
export type CreateBatchRecipeVersion = z.infer<
  typeof createBatchRecipeVersionSchema
>;

export const activateBatchRecipeVersionSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type ActivateBatchRecipeVersion = z.infer<
  typeof activateBatchRecipeVersionSchema
>;

export const batchRecipeVersionResponseSchema = z.object({
  id,
  branchId: id,
  outputInventoryItemId: id,
  version: z.number().int().positive(),
  status: recipeStatusSchema,
  revision: z.number().int().positive(),
  yieldQuantityMicros: positiveInventoryQuantityMicrosSchema,
  effectiveFrom: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  outputInventoryItem: inventoryItemResponseSchema,
  components: z.array(
    z.object({
      inventoryItemId: id,
      quantityMicros: positiveInventoryQuantityMicrosSchema,
      inventoryItem: inventoryItemResponseSchema,
    }),
  ),
});
export const batchRecipeVersionListResponseSchema = z.array(
  batchRecipeVersionResponseSchema,
);
export type BatchRecipeVersionResponse = z.infer<
  typeof batchRecipeVersionResponseSchema
>;

export const batchProductionPreviewSchema = z
  .object({
    branchId: id,
    batchRecipeVersionId: id,
    outputQuantityMicros: positiveInventoryQuantityMicrosSchema,
    outputLocationId: id,
    inputLocations: z
      .array(z.object({ inventoryItemId: id, locationId: id }))
      .min(1)
      .max(100),
    occurredAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    const ids = value.inputLocations.map((entry) => entry.inventoryItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputLocations"],
        message: "Batch input locations must be unique by inventory item.",
      });
    }
  });
export type BatchProductionPreview = z.infer<
  typeof batchProductionPreviewSchema
>;

export const batchProductionPreviewResponseSchema = z.object({
  configured: z.literal(true),
  batchRecipeVersionId: id,
  batchRecipeVersion: z.number().int().positive(),
  outputInventoryItemId: id,
  outputInventoryItemName: z.string().min(1).max(160),
  outputLocationId: id,
  outputQuantityMicros: positiveInventoryQuantityMicrosSchema,
  occurredAt: z.string().datetime(),
  inputs: z.array(
    z.object({
      inventoryItemId: id,
      inventoryItemName: z.string().min(1).max(160),
      locationId: id,
      quantityMicros: positiveInventoryQuantityMicrosSchema,
    }),
  ),
});
export type BatchProductionPreviewResponse = z.infer<
  typeof batchProductionPreviewResponseSchema
>;

export const postBatchProductionSchema = batchProductionPreviewSchema
  .extend({
    productionId: id,
    outputLedgerEntryId: id,
    inputLedgerEntries: z
      .array(z.object({ inventoryItemId: id, ledgerEntryId: id }))
      .min(1)
      .max(100),
    allowNegativeOverride: z.boolean().default(false),
    reason,
  })
  .superRefine((value, context) => {
    const items = value.inputLedgerEntries.map(
      (entry) => entry.inventoryItemId,
    );
    const ledgers = [
      value.outputLedgerEntryId,
      ...value.inputLedgerEntries.map((entry) => entry.ledgerEntryId),
    ];
    if (
      new Set(items).size !== items.length ||
      new Set(ledgers).size !== ledgers.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputLedgerEntries"],
        message: "Batch ledger mappings and IDs must be unique.",
      });
    }
  });
export type PostBatchProduction = z.infer<typeof postBatchProductionSchema>;

export const reverseBatchProductionSchema = z
  .object({
    reversalId: id,
    branchId: id,
    productionRevision: z.number().int().positive(),
    allowNegativeOverride: z.boolean().default(false),
    ledgerEntries: z
      .array(
        z.object({
          originalLedgerEntryId: id,
          reversalLedgerEntryId: id,
        }),
      )
      .min(2)
      .max(101),
    reason,
  })
  .superRefine((value, context) => {
    const originals = value.ledgerEntries.map(
      (entry) => entry.originalLedgerEntryId,
    );
    const reversals = value.ledgerEntries.map(
      (entry) => entry.reversalLedgerEntryId,
    );
    if (
      new Set(originals).size !== originals.length ||
      new Set(reversals).size !== reversals.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ledgerEntries"],
        message: "Batch reversal mappings must be unique.",
      });
    }
  });
export type ReverseBatchProduction = z.infer<
  typeof reverseBatchProductionSchema
>;

export const batchProductionResponseSchema = z.object({
  id,
  branchId: id,
  batchRecipeVersionId: id,
  outputInventoryItemId: id,
  outputLocationId: id,
  outputQuantityMicros: positiveInventoryQuantityMicrosSchema,
  outputLedgerEntryId: id,
  revision: z.number().int().positive(),
  negativeStockOverride: z.boolean(),
  reason: z.string().min(1).max(500),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  actorDisplayName: z.string().min(1).max(120),
  outputInventoryItem: z.object({ id, name: z.string().min(1).max(160) }),
  outputLocation: z.object({ id, name: z.string().min(1).max(120) }),
  inputs: z.array(
    z.object({
      id,
      inventoryItemId: id,
      locationId: id,
      quantityMicros: positiveInventoryQuantityMicrosSchema,
      ledgerEntryId: id,
      inventoryItem: z.object({ id, name: z.string().min(1).max(160) }),
      location: z.object({ id, name: z.string().min(1).max(120) }),
    }),
  ),
  reversal: z
    .object({
      id,
      reason: z.string().min(1).max(500),
      createdAt: z.string().datetime(),
      entries: z.array(
        z.object({
          id,
          originalLedgerEntryId: id,
          reversalLedgerEntryId: id,
        }),
      ),
    })
    .nullable(),
});
export const batchProductionListResponseSchema = z.array(
  batchProductionResponseSchema,
);
export type BatchProductionResponse = z.infer<
  typeof batchProductionResponseSchema
>;

export const inventoryProductionListQuerySchema = z.object({
  inventoryItemId: id.optional(),
  locationId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type InventoryProductionListQuery = z.infer<
  typeof inventoryProductionListQuerySchema
>;
