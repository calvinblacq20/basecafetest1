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
const quantityMicros = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => {
    try {
      return BigInt(value) <= 9_223_372_036_854_775_807n;
    } catch {
      return false;
    }
  });

export const purchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
]);

export const procurementListQuerySchema = z.object({
  status: purchaseOrderStatusSchema.optional(),
  supplierId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  includeInactive: z.coerce.boolean().default(false),
});
export type ProcurementListQuery = z.infer<typeof procurementListQuerySchema>;

export const createSupplierSchema = z.object({
  supplierId: id,
  branchId: id,
  externalKey,
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().min(1).max(120).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  paymentTerms: z.string().trim().min(1).max(240).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  reason,
});
export type CreateSupplier = z.infer<typeof createSupplierSchema>;

export const createSupplierItemSchema = z.object({
  supplierItemId: id,
  branchId: id,
  supplierId: id,
  inventoryItemId: id,
  purchaseUnitId: id,
  supplierSku: z.string().trim().min(1).max(100).nullable().optional(),
  reason,
});
export type CreateSupplierItem = z.infer<typeof createSupplierItemSchema>;

const purchaseOrderLineSchema = z.object({
  purchaseOrderLineId: id,
  supplierItemId: id,
  orderedQuantityMicros: quantityMicros,
  unitCostMinor: z.number().int().min(0).max(2_000_000_000),
});

export const createPurchaseOrderSchema = z
  .object({
    purchaseOrderId: id,
    branchId: id,
    supplierId: id,
    clientReference: z.string().trim().min(1).max(120),
    expectedAt: z.string().datetime().nullable().optional(),
    lines: z.array(purchaseOrderLineSchema).min(1).max(500),
    reason,
  })
  .superRefine((value, context) => {
    const supplierItems = value.lines.map((line) => line.supplierItemId);
    if (new Set(supplierItems).size !== supplierItems.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Purchase-order supplier items must be unique.",
      });
    }
  });
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;

export const transitionPurchaseOrderSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type TransitionPurchaseOrder = z.infer<
  typeof transitionPurchaseOrderSchema
>;

const receiptLineSchema = z.object({
  goodsReceiptLineId: id,
  purchaseOrderLineId: id,
  stockLedgerEntryId: id,
  locationId: id,
  receivedQuantityMicros: quantityMicros,
  lotReference: z.string().trim().min(1).max(120).nullable().optional(),
  expiresOn: z.string().date().nullable().optional(),
});

export const postGoodsReceiptSchema = z
  .object({
    goodsReceiptId: id,
    branchId: id,
    purchaseOrderRevision: z.number().int().positive(),
    supplierDocumentReference: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .optional(),
    receivedAt: z.string().datetime(),
    lines: z.array(receiptLineSchema).min(1).max(500),
    reason,
  })
  .superRefine((value, context) => {
    const poLines = value.lines.map((line) => line.purchaseOrderLineId);
    if (new Set(poLines).size !== poLines.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "A receipt may contain each purchase-order line once.",
      });
    }
  });
export type PostGoodsReceipt = z.infer<typeof postGoodsReceiptSchema>;

export const postPurchaseReturnSchema = z
  .object({
    purchaseReturnId: id,
    branchId: id,
    supplierDocumentReference: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .optional(),
    returnedAt: z.string().datetime(),
    lines: z
      .array(
        z.object({
          purchaseReturnLineId: id,
          goodsReceiptLineId: id,
          stockLedgerEntryId: id,
          returnedQuantityMicros: quantityMicros,
        }),
      )
      .min(1)
      .max(500),
    allowNegativeOverride: z.boolean().default(false),
    reason,
  })
  .superRefine((value, context) => {
    const receiptLines = value.lines.map((line) => line.goodsReceiptLineId);
    if (new Set(receiptLines).size !== receiptLines.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "A return may contain each receipt line once.",
      });
    }
  });
export type PostPurchaseReturn = z.infer<typeof postPurchaseReturnSchema>;

export const procurementValuationQuerySchema = z.object({
  locationId: id.optional(),
  inventoryItemId: id.optional(),
});
export type ProcurementValuationQuery = z.infer<
  typeof procurementValuationQuerySchema
>;

const timestamp = z.string().datetime();
const integerMicros = z.string().regex(/^-?(0|[1-9][0-9]{0,18})$/);
const actorName = z.string().trim().min(1).max(120);

export const supplierItemResponseSchema = z.object({
  id,
  branchId: id,
  supplierId: id,
  inventoryItemId: id,
  purchaseUnitId: id,
  supplierSku: z.string().max(100).nullable(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  inventoryItem: z.object({
    id,
    externalKey: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    baseUnitId: id,
  }),
  purchaseUnit: z.object({
    id,
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    dimension: z.enum(["MASS", "VOLUME", "COUNT"]),
  }),
});
export type SupplierItemResponse = z.infer<typeof supplierItemResponseSchema>;

export const supplierResponseSchema = z.object({
  id,
  branchId: id,
  externalKey: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  contactName: z.string().min(1).max(120).nullable(),
  phone: z.string().min(3).max(40).nullable(),
  email: z.string().email().max(254).nullable(),
  paymentTerms: z.string().min(1).max(240).nullable(),
  leadTimeDays: z.number().int().min(0).max(365).nullable(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  items: z.array(supplierItemResponseSchema),
});
export const supplierListResponseSchema = z.array(supplierResponseSchema);
export type SupplierResponse = z.infer<typeof supplierResponseSchema>;

export const purchaseOrderLineResponseSchema = z.object({
  id,
  supplierItemId: id,
  inventoryItemId: id,
  purchaseUnitId: id,
  inventoryItemName: z.string().min(1).max(160),
  inventoryItemExternalKey: z.string().min(1).max(80),
  purchaseUnitCode: z.string().min(1).max(80),
  orderedQuantityMicros: quantityMicros,
  conversionNumerator: quantityMicros,
  conversionDenominator: quantityMicros,
  unitCostMinor: z.number().int().min(0),
  lineCostMinor: z.number().int().min(0),
});

export const goodsReceiptLineResponseSchema = z.object({
  id,
  purchaseOrderLineId: id,
  locationId: id,
  inventoryItemId: id,
  purchaseUnitId: id,
  receivedQuantityMicros: quantityMicros,
  receivedBaseMicros: quantityMicros,
  unitCostMinor: z.number().int().min(0),
  lineCostMinor: z.number().int().min(0),
  lotReference: z.string().min(1).max(120).nullable(),
  expiresOn: z.string().date().nullable(),
});

export const goodsReceiptResponseSchema = z.object({
  id,
  branchId: id,
  purchaseOrderId: id,
  supplierId: id,
  currency: z.string().length(3),
  totalCostMinor: z.number().int().min(0),
  supplierDocumentReference: z.string().min(1).max(160).nullable(),
  receivedAt: timestamp,
  reason: z.string().min(1).max(500),
  createdAt: timestamp,
  postedByDisplayName: actorName,
  supplier: z.object({ id, name: z.string().min(1).max(160) }),
  lines: z.array(goodsReceiptLineResponseSchema),
});
export const goodsReceiptListResponseSchema = z.array(
  goodsReceiptResponseSchema,
);
export type GoodsReceiptResponse = z.infer<typeof goodsReceiptResponseSchema>;

export const purchaseOrderResponseSchema = z.object({
  id,
  branchId: id,
  supplierId: id,
  clientReference: z.string().min(1).max(120),
  status: purchaseOrderStatusSchema,
  revision: z.number().int().positive(),
  currency: z.string().length(3),
  totalCostMinor: z.number().int().min(0),
  expectedAt: timestamp.nullable(),
  reason: z.string().min(1).max(500),
  submittedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByDisplayName: actorName,
  submittedByDisplayName: actorName.nullable(),
  cancelledByDisplayName: actorName.nullable(),
  supplier: z.object({
    id,
    name: z.string().min(1).max(160),
    externalKey: z.string().min(1).max(80),
  }),
  lines: z.array(purchaseOrderLineResponseSchema),
  receipts: z.array(goodsReceiptResponseSchema),
});
export const purchaseOrderListResponseSchema = z.array(
  purchaseOrderResponseSchema,
);
export type PurchaseOrderResponse = z.infer<typeof purchaseOrderResponseSchema>;

export const purchaseReturnLineResponseSchema = z.object({
  id,
  goodsReceiptLineId: id,
  locationId: id,
  inventoryItemId: id,
  returnedQuantityMicros: quantityMicros,
  returnedBaseMicros: quantityMicros,
  unitCostMinor: z.number().int().min(0),
  lineCostMinor: z.number().int().min(0),
});

export const purchaseReturnResponseSchema = z.object({
  id,
  branchId: id,
  goodsReceiptId: id,
  supplierId: id,
  currency: z.string().length(3),
  totalCostMinor: z.number().int().min(0),
  supplierDocumentReference: z.string().min(1).max(160).nullable(),
  returnedAt: timestamp,
  reason: z.string().min(1).max(500),
  negativeStockOverride: z.boolean(),
  createdAt: timestamp,
  postedByDisplayName: actorName,
  supplier: z.object({ id, name: z.string().min(1).max(160) }),
  lines: z.array(purchaseReturnLineResponseSchema),
});
export const purchaseReturnListResponseSchema = z.array(
  purchaseReturnResponseSchema,
);
export type PurchaseReturnResponse = z.infer<
  typeof purchaseReturnResponseSchema
>;

export const procurementValuationResponseSchema = z.object({
  generatedAt: timestamp,
  branchId: id,
  currency: z.string().length(3),
  officialValuationAvailable: z.literal(false),
  configurationIssue: z.literal("INVENTORY_COST_METHOD_UNCONFIRMED"),
  basis: z.literal("PROVISIONAL_NET_RECEIPT_COST"),
  rows: z.array(
    z.object({
      locationId: id,
      inventoryItemId: id,
      quantityMicros: integerMicros,
      netReceivedBaseMicros: integerMicros,
      netReceivedCostMinor: integerMicros,
      weightedAverageCostNumerator: integerMicros,
      weightedAverageCostDenominator: integerMicros,
      lastPurchaseUnitCostMinor: z.number().int().min(0).nullable(),
    }),
  ),
});
export type ProcurementValuationResponse = z.infer<
  typeof procurementValuationResponseSchema
>;
