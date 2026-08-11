import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);
const externalKey = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());

export const inventoryUnitDimensionSchema = z.enum(["MASS", "VOLUME", "COUNT"]);
export type InventoryUnitDimension = z.infer<
  typeof inventoryUnitDimensionSchema
>;
export const inventoryLocationKindSchema = z.enum([
  "STORE",
  "KITCHEN",
  "BAR",
  "OTHER",
]);
export type InventoryLocationKind = z.infer<typeof inventoryLocationKindSchema>;
export const recipeStatusSchema = z.enum(["DRAFT", "ACTIVE", "CANCELLED"]);
export type RecipeStatus = z.infer<typeof recipeStatusSchema>;
export const stockLedgerTypeSchema = z.enum([
  "OPENING_BALANCE",
  "MANUAL_ADJUSTMENT",
  "WASTE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNT_ADJUSTMENT",
  "SALE_CONSUMPTION",
  "PURCHASE_RECEIPT",
  "PURCHASE_RETURN",
  "PRODUCTION_INPUT",
  "PRODUCTION_OUTPUT",
  "REVERSAL",
]);
export const stockCountStatusSchema = z.enum(["DRAFT", "POSTED", "CANCELLED"]);

// One base unit equals 1,000,000 micros. Strings keep BigInt values JSON-safe.
const postgresBigIntMaximum = 9_223_372_036_854_775_807n;
const withinPostgresBigInt = (value: string) => {
  try {
    return BigInt(value) <= postgresBigIntMaximum;
  } catch {
    return false;
  }
};
export const inventoryQuantityMicrosSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(withinPostgresBigInt);
export const positiveInventoryQuantityMicrosSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(withinPostgresBigInt);
export const signedInventoryQuantityMicrosSchema = z
  .string()
  .regex(/^-?[1-9][0-9]{0,18}$/)
  .refine((value) => {
    try {
      return (
        BigInt(value) >= -postgresBigIntMaximum &&
        BigInt(value) <= postgresBigIntMaximum
      );
    } catch {
      return false;
    }
  });

export const inventoryBranchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  includeInactive: z.coerce.boolean().default(false),
});
export type InventoryBranchQuery = z.infer<typeof inventoryBranchQuerySchema>;

export const inventoryLedgerQuerySchema = z.object({
  locationId: id.optional(),
  inventoryItemId: id.optional(),
  type: stockLedgerTypeSchema.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type InventoryLedgerQuery = z.infer<typeof inventoryLedgerQuerySchema>;

export const createInventoryUnitSchema = z.object({
  unitId: id,
  branchId: id,
  code: externalKey,
  name: z.string().trim().min(1).max(100),
  dimension: inventoryUnitDimensionSchema,
  reason,
});
export type CreateInventoryUnit = z.infer<typeof createInventoryUnitSchema>;

export const createInventoryUnitConversionSchema = z.object({
  conversionId: id,
  branchId: id,
  fromUnitId: id,
  toUnitId: id,
  numerator: z.string().regex(/^[1-9][0-9]{0,18}$/),
  denominator: z.string().regex(/^[1-9][0-9]{0,18}$/),
  reason,
});
export type CreateInventoryUnitConversion = z.infer<
  typeof createInventoryUnitConversionSchema
>;

export const createStockLocationSchema = z.object({
  locationId: id,
  branchId: id,
  externalKey,
  name: z.string().trim().min(1).max(120),
  kind: inventoryLocationKindSchema,
  reason,
});
export type CreateStockLocation = z.infer<typeof createStockLocationSchema>;

export const createInventoryItemSchema = z.object({
  inventoryItemId: id,
  branchId: id,
  externalKey,
  name: z.string().trim().min(1).max(160),
  baseUnitId: id,
  reason,
});
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;

export const createRecipeVersionSchema = z
  .object({
    recipeVersionId: id,
    branchId: id,
    menuItemId: id,
    menuVariantId: id.nullable().optional(),
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
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: "Recipe components must be unique.",
      });
  });
export type CreateRecipeVersion = z.infer<typeof createRecipeVersionSchema>;

export const activateRecipeVersionSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type ActivateRecipeVersion = z.infer<typeof activateRecipeVersionSchema>;

export const postStockAdjustmentSchema = z.object({
  ledgerEntryId: id,
  branchId: id,
  locationId: id,
  inventoryItemId: id,
  type: z.enum(["OPENING_BALANCE", "MANUAL_ADJUSTMENT", "WASTE"]),
  quantityDeltaMicros: signedInventoryQuantityMicrosSchema,
  allowNegativeOverride: z.boolean().default(false),
  reason,
});
export type PostStockAdjustment = z.infer<typeof postStockAdjustmentSchema>;

export const postInventoryTransferSchema = z
  .object({
    transferId: id,
    outboundEntryId: id,
    inboundEntryId: id,
    branchId: id,
    inventoryItemId: id,
    fromLocationId: id,
    toLocationId: id,
    quantityMicros: positiveInventoryQuantityMicrosSchema,
    allowNegativeOverride: z.boolean().default(false),
    reason,
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    path: ["toLocationId"],
    message: "Transfer locations must differ.",
  });
export type PostInventoryTransfer = z.infer<typeof postInventoryTransferSchema>;

export const createStockCountSchema = z
  .object({
    stockCountId: id,
    branchId: id,
    locationId: id,
    lines: z
      .array(
        z.object({
          inventoryItemId: id,
          countedQuantityMicros: inventoryQuantityMicrosSchema,
        }),
      )
      .min(1)
      .max(1000),
    reason,
  })
  .superRefine((value, context) => {
    const ids = value.lines.map((line) => line.inventoryItemId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Stock-count items must be unique.",
      });
  });
export type CreateStockCount = z.infer<typeof createStockCountSchema>;

export const postStockCountSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type PostStockCount = z.infer<typeof postStockCountSchema>;

export const inventoryConsumptionPreviewSchema = z.object({
  branchId: id,
  menuItemId: id,
  menuVariantId: id.nullable().optional(),
  quantity: z.number().int().positive().max(10_000),
  at: z.string().datetime().optional(),
});
export type InventoryConsumptionPreview = z.infer<
  typeof inventoryConsumptionPreviewSchema
>;

const timestamp = z.string().datetime();

export const inventoryUnitSummaryResponseSchema = z.object({
  id,
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  dimension: inventoryUnitDimensionSchema,
  isActive: z.boolean(),
  revision: z.number().int().positive(),
});

export const inventoryUnitConversionResponseSchema = z.object({
  id,
  fromUnitId: id,
  toUnitId: id,
  numerator: positiveInventoryQuantityMicrosSchema,
  denominator: positiveInventoryQuantityMicrosSchema,
  createdAt: timestamp,
  toUnit: inventoryUnitSummaryResponseSchema,
});

export const inventoryUnitResponseSchema =
  inventoryUnitSummaryResponseSchema.extend({
    createdAt: timestamp,
    updatedAt: timestamp,
    conversionsFrom: z.array(inventoryUnitConversionResponseSchema),
  });
export const inventoryUnitListResponseSchema = z.array(
  inventoryUnitResponseSchema,
);
export type InventoryUnitResponse = z.infer<typeof inventoryUnitResponseSchema>;

export const stockLocationResponseSchema = z.object({
  id,
  branchId: id,
  externalKey,
  name: z.string().min(1).max(120),
  kind: inventoryLocationKindSchema,
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const stockLocationListResponseSchema = z.array(
  stockLocationResponseSchema,
);
export type StockLocationResponse = z.infer<typeof stockLocationResponseSchema>;

export const inventoryItemResponseSchema = z.object({
  id,
  branchId: id,
  baseUnitId: id,
  externalKey,
  name: z.string().min(1).max(160),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  baseUnit: inventoryUnitSummaryResponseSchema,
});
export const inventoryItemListResponseSchema = z.array(
  inventoryItemResponseSchema,
);
export type InventoryItemResponse = z.infer<typeof inventoryItemResponseSchema>;

export const recipeVersionResponseSchema = z.object({
  id,
  branchId: id,
  menuItemId: id,
  menuVariantId: id.nullable(),
  version: z.number().int().positive(),
  status: recipeStatusSchema,
  revision: z.number().int().positive(),
  yieldQuantityMicros: positiveInventoryQuantityMicrosSchema,
  effectiveFrom: timestamp,
  activatedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  menuItem: z.object({ id, name: z.string().min(1).max(160) }),
  menuVariant: z.object({ id, name: z.string().min(1).max(160) }).nullable(),
  components: z.array(
    z.object({
      inventoryItemId: id,
      quantityMicros: positiveInventoryQuantityMicrosSchema,
      inventoryItem: inventoryItemResponseSchema,
    }),
  ),
});
export const recipeVersionListResponseSchema = z.array(
  recipeVersionResponseSchema,
);
export type RecipeVersionResponse = z.infer<typeof recipeVersionResponseSchema>;

export const stockLedgerEntryResponseSchema = z.object({
  id,
  branchId: id,
  locationId: id,
  inventoryItemId: id,
  type: stockLedgerTypeSchema,
  quantityDeltaMicros: signedInventoryQuantityMicrosSchema,
  sourceType: z.string().min(1).max(80),
  sourceId: id,
  negativeStockOverride: z.boolean(),
  reason: z.string().min(1).max(500),
  occurredAt: timestamp,
  createdAt: timestamp,
  location: z.object({ id, name: z.string().min(1).max(120) }),
  inventoryItem: z.object({
    id,
    name: z.string().min(1).max(160),
    baseUnit: inventoryUnitSummaryResponseSchema,
  }),
  actorDisplayName: z.string().min(1).max(120),
});
export const stockLedgerListResponseSchema = z.array(
  stockLedgerEntryResponseSchema,
);
export type StockLedgerEntryResponse = z.infer<
  typeof stockLedgerEntryResponseSchema
>;

export const inventoryBalanceResponseSchema = z.object({
  locationId: id,
  inventoryItemId: id,
  quantityMicros: z
    .string()
    .regex(/^-?(0|[1-9][0-9]{0,18})$/)
    .refine((value) => {
      try {
        return (
          BigInt(value) >= -postgresBigIntMaximum &&
          BigInt(value) <= postgresBigIntMaximum
        );
      } catch {
        return false;
      }
    }),
});
export const inventoryBalanceListResponseSchema = z.array(
  inventoryBalanceResponseSchema,
);
export type InventoryBalanceResponse = z.infer<
  typeof inventoryBalanceResponseSchema
>;

export const inventoryTransferResponseSchema = z.object({
  id,
  branchId: id,
  inventoryItemId: id,
  fromLocationId: id,
  toLocationId: id,
  quantityMicros: positiveInventoryQuantityMicrosSchema,
  reason: z.string().min(1).max(500),
  createdAt: timestamp,
  inventoryItem: inventoryItemResponseSchema,
  fromLocation: z.object({ id, name: z.string().min(1).max(120) }),
  toLocation: z.object({ id, name: z.string().min(1).max(120) }),
  actorDisplayName: z.string().min(1).max(120),
});
export const inventoryTransferListResponseSchema = z.array(
  inventoryTransferResponseSchema,
);
export type InventoryTransferResponse = z.infer<
  typeof inventoryTransferResponseSchema
>;

export const stockCountResponseSchema = z.object({
  id,
  branchId: id,
  locationId: id,
  status: stockCountStatusSchema,
  revision: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  postedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  location: z.object({ id, name: z.string().min(1).max(120) }),
  createdByDisplayName: z.string().min(1).max(120),
  postedByDisplayName: z.string().min(1).max(120).nullable(),
  lines: z.array(
    z.object({
      inventoryItemId: id,
      countedQuantityMicros: inventoryQuantityMicrosSchema,
      inventoryItem: inventoryItemResponseSchema,
    }),
  ),
});
export const stockCountListResponseSchema = z.array(stockCountResponseSchema);
export const postedStockCountResponseSchema = z.object({
  count: stockCountResponseSchema,
  entries: stockLedgerListResponseSchema,
});
export type StockCountResponse = z.infer<typeof stockCountResponseSchema>;
