import { z } from "zod";

const identifierSchema = z.string().uuid();
const externalKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());

const reasonSchema = z.string().trim().min(1).max(500);
const effectiveAtSchema = z.string().datetime();

export const taxTreatmentSchema = z.enum([
  "STANDARD",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
]);

export type TaxTreatment = z.infer<typeof taxTreatmentSchema>;

export const taxPriceModeSchema = z.enum(["INCLUSIVE", "EXCLUSIVE"]);
export const taxRoundingModeSchema = z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]);
export const taxRoundingScopeSchema = z.enum(["LINE", "INVOICE"]);

export const taxComponentInputSchema = z.object({
  code: externalKeySchema,
  receiptLabel: z.string().trim().min(1).max(80),
  ratePpm: z.number().int().min(0).max(1_000_000),
  calculationOrder: z.number().int().min(0).max(100),
});

const taxComponentsSchema = z
  .array(taxComponentInputSchema)
  .min(1)
  .max(20)
  .superRefine((components, context) => {
    const codes = new Set<string>();
    const orders = new Set<number>();
    for (const [index, component] of components.entries()) {
      if (codes.has(component.code)) {
        context.addIssue({
          code: "custom",
          message: "Tax component codes must be unique within a profile.",
          path: [index, "code"],
        });
      }
      if (orders.has(component.calculationOrder)) {
        context.addIssue({
          code: "custom",
          message: "Tax component calculation orders must be unique.",
          path: [index, "calculationOrder"],
        });
      }
      codes.add(component.code);
      orders.add(component.calculationOrder);
    }
  });

function validateInterval(
  value: { effectiveFrom?: string; effectiveTo?: string | null },
  context: z.RefinementCtx,
) {
  if (
    value.effectiveFrom &&
    value.effectiveTo &&
    new Date(value.effectiveTo) <= new Date(value.effectiveFrom)
  ) {
    context.addIssue({
      code: "custom",
      message: "effectiveTo must be later than effectiveFrom.",
      path: ["effectiveTo"],
    });
  }
}

export const createTaxProfileRequestSchema = z
  .object({
    branchId: identifierSchema,
    key: externalKeySchema,
    name: z.string().trim().min(1).max(120),
    priceMode: taxPriceModeSchema,
    roundingMode: taxRoundingModeSchema,
    roundingScope: taxRoundingScopeSchema,
    effectiveFrom: effectiveAtSchema,
    effectiveTo: effectiveAtSchema.nullable().optional(),
    components: taxComponentsSchema,
    reason: reasonSchema,
  })
  .superRefine(validateInterval);

export type CreateTaxProfileRequest = z.infer<
  typeof createTaxProfileRequestSchema
>;

export const updateTaxProfileRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    priceMode: taxPriceModeSchema.optional(),
    roundingMode: taxRoundingModeSchema.optional(),
    roundingScope: taxRoundingScopeSchema.optional(),
    effectiveFrom: effectiveAtSchema.optional(),
    effectiveTo: effectiveAtSchema.nullable().optional(),
    components: taxComponentsSchema.optional(),
    reason: reasonSchema,
  })
  .superRefine((value, context) => {
    validateInterval(value, context);
    if (
      value.name === undefined &&
      value.priceMode === undefined &&
      value.roundingMode === undefined &&
      value.roundingScope === undefined &&
      value.effectiveFrom === undefined &&
      value.effectiveTo === undefined &&
      value.components === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "At least one tax profile field must be changed.",
      });
    }
  });

export type UpdateTaxProfileRequest = z.infer<
  typeof updateTaxProfileRequestSchema
>;

export const confirmTaxProfileRequestSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  approvalReference: z.string().trim().min(3).max(240),
  reason: reasonSchema,
});

export type ConfirmTaxProfileRequest = z.infer<
  typeof confirmTaxProfileRequestSchema
>;

export const activateTaxProfileRequestSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  reason: reasonSchema,
});

export type ActivateTaxProfileRequest = z.infer<
  typeof activateTaxProfileRequestSchema
>;

export const taxCalculationPreviewRequestSchema = z.object({
  branchId: identifierSchema,
  taxClassId: identifierSchema,
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type TaxCalculationPreviewRequest = z.infer<
  typeof taxCalculationPreviewRequestSchema
>;

export const taxProfileStatusSchema = z.enum(["DRAFT", "CONFIRMED", "ACTIVE"]);

export const taxComponentResponseSchema = taxComponentInputSchema.extend({
  id: identifierSchema,
  createdAt: z.string().datetime(),
});

export const taxProfileResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  key: externalKeySchema,
  name: z.string().min(1).max(120),
  status: taxProfileStatusSchema,
  priceMode: taxPriceModeSchema,
  roundingMode: taxRoundingModeSchema,
  roundingScope: taxRoundingScopeSchema,
  currency: z.string().length(3),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  revision: z.number().int().positive(),
  approvalRecorded: z.boolean(),
  confirmedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  components: z.array(taxComponentResponseSchema).max(20),
});

export type TaxProfileResponse = z.infer<typeof taxProfileResponseSchema>;
export const taxProfileListResponseSchema = z.array(taxProfileResponseSchema);

export const ghanaVatReferenceComponentSchema = z.object({
  code: z.enum(["VAT", "NHIL", "GETFUND"]),
  receiptLabel: z.string().min(1),
  ratePpm: z.number().int().nonnegative(),
  ratePercent: z.string().regex(/^\d+(?:\.\d+)?$/),
  calculationOrder: z.number().int().nonnegative(),
  commonBase: z.literal(true),
});

export const ghanaVatReferenceSchema = z.object({
  referenceId: z.literal("GRA_VAT_2026"),
  jurisdiction: z.literal("GH"),
  authority: z.literal("Ghana Revenue Authority"),
  label: z.literal("GRA 2026 VAT reference"),
  effectiveFrom: z.literal("2026-01-01"),
  source: z.object({
    title: z.literal("Value Added Tax – VAT"),
    url: z.literal("https://gra.gov.gh/domestic-tax/tax-types/vat/"),
    checkedAt: z.string().date(),
  }),
  components: z.tuple([
    ghanaVatReferenceComponentSchema,
    ghanaVatReferenceComponentSchema,
    ghanaVatReferenceComponentSchema,
  ]),
  covid19HealthRecoveryLevyIncluded: z.literal(false),
  fillsPriceMode: z.literal(false),
  fillsRounding: z.literal(false),
  activationAllowed: z.literal(false),
});

export type GhanaVatReference = z.infer<typeof ghanaVatReferenceSchema>;

export const ghanaVatReference2026: GhanaVatReference =
  ghanaVatReferenceSchema.parse({
    referenceId: "GRA_VAT_2026",
    jurisdiction: "GH",
    authority: "Ghana Revenue Authority",
    label: "GRA 2026 VAT reference",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Value Added Tax – VAT",
      url: "https://gra.gov.gh/domestic-tax/tax-types/vat/",
      checkedAt: "2026-08-09",
    },
    components: [
      {
        code: "VAT",
        receiptLabel: "VAT",
        ratePpm: 150_000,
        ratePercent: "15",
        calculationOrder: 0,
        commonBase: true,
      },
      {
        code: "NHIL",
        receiptLabel: "NHIL",
        ratePpm: 25_000,
        ratePercent: "2.5",
        calculationOrder: 1,
        commonBase: true,
      },
      {
        code: "GETFUND",
        receiptLabel: "GETFund Levy",
        ratePpm: 25_000,
        ratePercent: "2.5",
        calculationOrder: 2,
        commonBase: true,
      },
    ],
    covid19HealthRecoveryLevyIncluded: false,
    fillsPriceMode: false,
    fillsRounding: false,
    activationAllowed: false,
  });
