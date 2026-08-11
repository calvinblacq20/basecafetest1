import { z } from "zod";

const identifierSchema = z.string().uuid();
const importCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());
const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\\/\u0000-\u001f]+\.csv$/i);

export const menuImportV1Headers = [
  "row_action",
  "branch_code",
  "menu_code",
  "category_code",
  "category_name",
  "item_code",
  "item_name",
  "description",
  "variant_code",
  "variant_name",
  "price_ghs",
  "tax_class_code",
  "production_station_codes",
  "availability_schedule_code",
  "track_inventory",
  "recipe_code",
  "allergen_codes",
  "age_restricted",
  "display_order",
  "active",
  "notes",
] as const;

export const menuImportDryRunRequestSchema = z.object({
  branchId: identifierSchema,
  branchCode: importCodeSchema,
  menuCode: importCodeSchema,
  schemaVersion: z.literal("menu-v1"),
  fileName: fileNameSchema,
  csvText: z.string().min(1).max(75_000),
});

export type MenuImportDryRunRequest = z.infer<
  typeof menuImportDryRunRequestSchema
>;

export const menuImportApplyRequestSchema =
  menuImportDryRunRequestSchema.extend({
    validationHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(500),
  });

export type MenuImportApplyRequest = z.infer<
  typeof menuImportApplyRequestSchema
>;

export const menuImportIssueSchema = z.object({
  row: z.number().int().positive(),
  field: z.string(),
  severity: z.enum(["ERROR", "WARNING"]),
  code: z.string(),
  message: z.string(),
});

export const menuImportSummarySchema = z.object({
  dataRows: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
  variants: z.number().int().nonnegative(),
  prices: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});

export const menuImportDryRunResponseSchema = z.object({
  schemaVersion: z.literal("menu-v1"),
  fileName: fileNameSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  validationHash: z.string().regex(/^[a-f0-9]{64}$/),
  valid: z.boolean(),
  summary: menuImportSummarySchema,
  issues: z.array(menuImportIssueSchema),
});
export type MenuImportDryRunResponse = z.infer<
  typeof menuImportDryRunResponseSchema
>;

export const menuImportApplyResponseSchema = z.object({
  importId: identifierSchema,
  appliedAt: z.string().datetime(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  validationHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: menuImportSummarySchema,
  applied: z.object({
    categoriesUpserted: z.number().int().nonnegative(),
    itemsUpserted: z.number().int().nonnegative(),
    variantsUpserted: z.number().int().nonnegative(),
    pricesCreated: z.number().int().nonnegative(),
    pricesClosed: z.number().int().nonnegative(),
  }),
  issues: z.array(menuImportIssueSchema),
});
export type MenuImportApplyResponse = z.infer<
  typeof menuImportApplyResponseSchema
>;
