import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);
const nonNegativeMicros = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Must be an exact non-negative integer-micro value.")
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, {
    message: "Value exceeds the signed 64-bit database range.",
  });

export const availabilityTargetKindSchema = z.enum([
  "ITEM",
  "VARIANT",
  "MODIFIER",
]);
export const manualAvailabilityStateSchema = z.enum([
  "UNAVAILABLE",
  "RESTORED",
]);

export const createCriticalIngredientRuleSchema = z
  .object({
    ruleVersionId: id,
    branchId: id,
    menuItemId: id,
    menuVariantId: id.nullable().optional(),
    recipeVersionId: id,
    effectiveFrom: z.string().datetime(),
    components: z
      .array(
        z.object({
          inventoryItemId: id,
          safetyStockMicros: nonNegativeMicros,
          locationIds: z.array(id).min(1).max(20),
        }),
      )
      .min(1)
      .max(100),
    reason,
  })
  .superRefine((value, context) => {
    const items = value.components.map(
      ({ inventoryItemId }) => inventoryItemId,
    );
    if (new Set(items).size !== items.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Critical ingredients must be unique.",
      });
    }
    value.components.forEach((component, index) => {
      if (
        new Set(component.locationIds).size !== component.locationIds.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index, "locationIds"],
          message: "Eligible locations must be unique per ingredient.",
        });
      }
    });
  });
export type CreateCriticalIngredientRule = z.infer<
  typeof createCriticalIngredientRuleSchema
>;

export const confirmCriticalIngredientRuleSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  evidenceReference: z.string().trim().min(3).max(240),
  reason,
});
export type ConfirmCriticalIngredientRule = z.infer<
  typeof confirmCriticalIngredientRuleSchema
>;

export const criticalIngredientRuleRevisionSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type CriticalIngredientRuleRevision = z.infer<
  typeof criticalIngredientRuleRevisionSchema
>;

export const recordManualAvailabilitySchema = z
  .object({
    eventId: id,
    branchId: id,
    targetKind: availabilityTargetKindSchema,
    menuItemId: id.optional(),
    menuVariantId: id.optional(),
    menuModifierId: id.optional(),
    expectedRevision: z.number().int().min(0),
    state: manualAvailabilityStateSchema,
    effectiveFrom: z.string().datetime(),
    expiresAt: z.string().datetime().nullable().optional(),
    reason,
  })
  .superRefine((value, context) => {
    const exactTarget =
      (value.targetKind === "ITEM" &&
        !!value.menuItemId &&
        !value.menuVariantId &&
        !value.menuModifierId) ||
      (value.targetKind === "VARIANT" &&
        !!value.menuItemId &&
        !!value.menuVariantId &&
        !value.menuModifierId) ||
      (value.targetKind === "MODIFIER" &&
        !value.menuItemId &&
        !value.menuVariantId &&
        !!value.menuModifierId);
    if (!exactTarget) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKind"],
        message:
          "Target identifiers do not match the availability target kind.",
      });
    }
    if (value.state === "RESTORED" && value.expiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Restore events cannot expire.",
      });
    }
    if (
      value.expiresAt &&
      new Date(value.expiresAt).getTime() <=
        new Date(value.effectiveFrom).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "An unavailable expiry must be after its effective time.",
      });
    }
  });
export type RecordManualAvailability = z.infer<
  typeof recordManualAvailabilitySchema
>;

export const availabilityPreviewSchema = z.object({
  branchId: id,
  menuItemId: id,
  menuVariantId: id.nullable().optional(),
  quantity: z.number().int().min(1).max(1_000).default(1),
  at: z.string().datetime(),
});
export type AvailabilityPreview = z.infer<typeof availabilityPreviewSchema>;

export const availabilityHistoryQuerySchema = z
  .object({
    targetKind: availabilityTargetKindSchema.optional(),
    menuItemId: id.optional(),
    menuVariantId: id.optional(),
    menuModifierId: id.optional(),
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine(
    (value) =>
      [value.menuItemId, value.menuVariantId, value.menuModifierId].filter(
        Boolean,
      ).length <= 1,
    { message: "Only one target filter may be supplied." },
  );
export type AvailabilityHistoryQuery = z.infer<
  typeof availabilityHistoryQuerySchema
>;

const actorSummarySchema = z.object({ displayName: z.string() });
const namedEntitySchema = z.object({ id, name: z.string() });

export const criticalIngredientRuleResponseSchema = z.object({
  id,
  branchId: id,
  menuItemId: id,
  menuVariantId: id.nullable(),
  recipeVersionId: id,
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "CONFIRMED", "ACTIVE", "CANCELLED"]),
  revision: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  evidenceReference: z.string().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  menuItem: namedEntitySchema,
  menuVariant: namedEntitySchema.nullable(),
  recipeVersion: z.object({ id, version: z.number().int().positive() }),
  createdBy: actorSummarySchema,
  confirmedBy: actorSummarySchema.nullable(),
  activatedBy: actorSummarySchema.nullable(),
  components: z.array(
    z.object({
      inventoryItemId: id,
      safetyStockMicros: nonNegativeMicros,
      inventoryItem: namedEntitySchema,
      locations: z.array(
        z.object({ locationId: id, location: namedEntitySchema }),
      ),
    }),
  ),
});
export const criticalIngredientRuleListResponseSchema = z.array(
  criticalIngredientRuleResponseSchema,
);
export type CriticalIngredientRuleResponse = z.infer<
  typeof criticalIngredientRuleResponseSchema
>;

export const manualAvailabilityEventResponseSchema = z.object({
  id,
  branchId: id,
  targetKind: availabilityTargetKindSchema,
  menuItemId: id.nullable(),
  menuVariantId: id.nullable(),
  menuModifierId: id.nullable(),
  state: manualAvailabilityStateSchema,
  revision: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  reason: z.string(),
  createdAt: z.string().datetime(),
  actor: actorSummarySchema,
  device: z.object({ name: z.string() }),
});
export const manualAvailabilityEventListResponseSchema = z.array(
  manualAvailabilityEventResponseSchema,
);
export type ManualAvailabilityEventResponse = z.infer<
  typeof manualAvailabilityEventResponseSchema
>;

export const availabilityPreviewResponseSchema = z.object({
  configured: z.boolean(),
  available: z.boolean(),
  issueCode: z.string().nullable(),
  at: z.string().datetime(),
  quantity: z.number().int().positive(),
  menuItemId: id,
  menuVariantId: id.nullable(),
  manualEventId: id.nullable(),
  ruleVersionId: id.nullable().optional(),
  ruleVersion: z.number().int().positive().nullable().optional(),
  recipeVersionId: id.nullable().optional(),
  maxSellableQuantity: nonNegativeMicros.nullable().optional(),
  components: z.array(
    z.object({
      inventoryItemId: id,
      inventoryItemName: z.string(),
      locationIds: z.array(id),
      balanceMicros: z.string().regex(/^-?(0|[1-9]\d*)$/),
      safetyStockMicros: nonNegativeMicros,
      usableMicros: z.string().regex(/^-?(0|[1-9]\d*)$/),
      requiredQuantityMicros: nonNegativeMicros,
      available: z.boolean(),
    }),
  ),
});
export type AvailabilityPreviewResponse = z.infer<
  typeof availabilityPreviewResponseSchema
>;
