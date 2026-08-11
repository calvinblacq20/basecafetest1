import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

export const inventoryDeductionTriggerSchema = z.enum([
  "SENT",
  "PREPARED",
  "SERVED",
  "COMPLETED",
]);
export const inventoryPolicyStatusSchema = z.enum([
  "DRAFT",
  "CONFIRMED",
  "ACTIVE",
  "CANCELLED",
]);

export const createInventoryDeductionPolicySchema = z.object({
  policyVersionId: id,
  branchId: id,
  trigger: inventoryDeductionTriggerSchema,
  effectiveFrom: z.string().datetime(),
  reason,
});
export type CreateInventoryDeductionPolicy = z.infer<
  typeof createInventoryDeductionPolicySchema
>;

export const confirmInventoryDeductionPolicySchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  evidenceReference: z.string().trim().min(3).max(240),
  reason,
});
export type ConfirmInventoryDeductionPolicy = z.infer<
  typeof confirmInventoryDeductionPolicySchema
>;

export const activateInventoryDeductionPolicySchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type ActivateInventoryDeductionPolicy = z.infer<
  typeof activateInventoryDeductionPolicySchema
>;

export const createInventoryConsumptionRouteSchema = z.object({
  routeVersionId: id,
  branchId: id,
  inventoryItemId: id,
  stationId: id.nullable().optional(),
  locationId: id,
  effectiveFrom: z.string().datetime(),
  reason,
});
export type CreateInventoryConsumptionRoute = z.infer<
  typeof createInventoryConsumptionRouteSchema
>;

export const activateInventoryConsumptionRouteSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type ActivateInventoryConsumptionRoute = z.infer<
  typeof activateInventoryConsumptionRouteSchema
>;

export const inventoryConsumptionCommandSchema = z.object({
  branchId: id,
  orderLineId: id,
  sourceEventId: id,
  trigger: inventoryDeductionTriggerSchema,
});
export type InventoryConsumptionCommand = z.infer<
  typeof inventoryConsumptionCommandSchema
>;

export const postInventoryConsumptionSchema = inventoryConsumptionCommandSchema
  .extend({
    consumptionId: id,
    ledgerEntries: z
      .array(
        z.object({
          inventoryItemId: id,
          locationId: id,
          ledgerEntryId: id,
        }),
      )
      .min(1)
      .max(100),
    allowNegativeOverride: z.boolean().default(false),
    reason,
  })
  .superRefine((value, context) => {
    const targets = new Set<string>();
    const ledgers = new Set<string>();
    value.ledgerEntries.forEach((entry, index) => {
      const target = `${entry.inventoryItemId}:${entry.locationId}`;
      if (targets.has(target) || ledgers.has(entry.ledgerEntryId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ledgerEntries", index],
          message: "Ledger mappings must have unique targets and entry IDs.",
        });
      }
      targets.add(target);
      ledgers.add(entry.ledgerEntryId);
    });
  });
export type PostInventoryConsumption = z.infer<
  typeof postInventoryConsumptionSchema
>;

export const reverseInventoryConsumptionSchema = z
  .object({
    reversalId: id,
    branchId: id,
    consumptionRevision: z.number().int().positive(),
    ledgerEntries: z
      .array(
        z.object({
          consumptionEntryId: id,
          ledgerEntryId: id,
        }),
      )
      .min(1)
      .max(100),
    reason,
  })
  .superRefine((value, context) => {
    const entries = new Set<string>();
    const ledgers = new Set<string>();
    value.ledgerEntries.forEach((entry, index) => {
      if (
        entries.has(entry.consumptionEntryId) ||
        ledgers.has(entry.ledgerEntryId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ledgerEntries", index],
          message: "Reversal mappings must have unique source and ledger IDs.",
        });
      }
      entries.add(entry.consumptionEntryId);
      ledgers.add(entry.ledgerEntryId);
    });
  });
export type ReverseInventoryConsumption = z.infer<
  typeof reverseInventoryConsumptionSchema
>;

export const inventoryConsumptionListQuerySchema = z.object({
  orderId: id.optional(),
  orderLineId: id.optional(),
  reversed: z
    .union([
      z.boolean(),
      z.enum(["true", "false"]).transform((value) => value === "true"),
    ])
    .optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type InventoryConsumptionListQuery = z.infer<
  typeof inventoryConsumptionListQuerySchema
>;

const actorSummarySchema = z.object({ displayName: z.string() });
const namedEntitySchema = z.object({ id, name: z.string() });

export const inventoryDeductionPolicyResponseSchema = z.object({
  id,
  branchId: id,
  trigger: inventoryDeductionTriggerSchema,
  status: inventoryPolicyStatusSchema,
  revision: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  evidenceReference: z.string().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: actorSummarySchema,
  confirmedBy: actorSummarySchema.nullable(),
  activatedBy: actorSummarySchema.nullable(),
});
export const inventoryDeductionPolicyListResponseSchema = z.array(
  inventoryDeductionPolicyResponseSchema,
);
export type InventoryDeductionPolicyResponse = z.infer<
  typeof inventoryDeductionPolicyResponseSchema
>;

export const inventoryConsumptionRouteResponseSchema = z.object({
  id,
  branchId: id,
  inventoryItemId: id,
  stationId: id.nullable(),
  locationId: id,
  status: inventoryPolicyStatusSchema,
  revision: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  inventoryItem: namedEntitySchema.extend({ externalKey: z.string() }),
  station: namedEntitySchema.nullable(),
  location: namedEntitySchema.extend({ externalKey: z.string() }),
  createdBy: actorSummarySchema,
  activatedBy: actorSummarySchema.nullable(),
});
export const inventoryConsumptionRouteListResponseSchema = z.array(
  inventoryConsumptionRouteResponseSchema,
);
export type InventoryConsumptionRouteResponse = z.infer<
  typeof inventoryConsumptionRouteResponseSchema
>;

export const inventoryConsumptionResponseSchema = z.object({
  id,
  branchId: id,
  orderId: id,
  orderLineId: id,
  policyVersionId: id,
  recipeVersionId: id,
  sourceEventId: id,
  trigger: inventoryDeductionTriggerSchema,
  revision: z.number().int().positive(),
  orderLineQuantity: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  reason: z.string(),
  negativeStockOverride: z.boolean(),
  createdAt: z.string().datetime(),
  actor: actorSummarySchema,
  device: z.object({ name: z.string() }),
  entries: z.array(
    z.object({
      id,
      routeVersionId: id,
      inventoryItemId: id,
      locationId: id,
      quantityMicros: z.string().regex(/^(0|[1-9]\d*)$/),
      ledgerEntryId: id,
      inventoryItem: namedEntitySchema,
      location: namedEntitySchema,
      reversed: z.boolean(),
    }),
  ),
  reversed: z.boolean(),
});
export const inventoryConsumptionListResponseSchema = z.array(
  inventoryConsumptionResponseSchema,
);
export type InventoryConsumptionResponse = z.infer<
  typeof inventoryConsumptionResponseSchema
>;

export const inventoryConsumptionReconciliationResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  branchId: id,
  postingCommandEnabled: z.boolean(),
  automaticEventDispatchEnabled: z.literal(false),
  activePolicy: inventoryDeductionPolicyResponseSchema.nullable(),
  configurationIssue: z.string().nullable(),
  counts: z.object({
    sentLinesWithoutConsumption: z.number().int().nonnegative(),
    cancelledConsumedLinesWithoutReversal: z.number().int().nonnegative(),
    postedConsumptions: z.number().int().nonnegative(),
    postedReversals: z.number().int().nonnegative(),
  }),
});
export type InventoryConsumptionReconciliationResponse = z.infer<
  typeof inventoryConsumptionReconciliationResponseSchema
>;
