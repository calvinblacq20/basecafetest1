import { z } from "zod";

export * from "./administration.js";
export * from "./inventory-availability.js";
export * from "./branch-hours.js";
export * from "./cash-movements.js";
export * from "./catalog-import.js";
export * from "./kds.js";
export * from "./inventory.js";
export * from "./inventory-consumption.js";
export * from "./inventory-production.js";
export * from "./shifts.js";
export * from "./layout.js";
export * from "./mfa.js";
export * from "./procurement.js";
export * from "./privacy.js";
export * from "./security-operations.js";
export * from "./audit-integrity.js";
export * from "./pilot-readiness.js";
export * from "./orders.js";
export * from "./operations.js";
export * from "./payments.js";
export * from "./refunds.js";
export * from "./receipts.js";
export * from "./reports.js";
export * from "./sync.js";
export * from "./tax.js";

export const identifierSchema = z.string().uuid();

export const externalKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(200),
    deviceId: identifierSchema,
    deviceFingerprintHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    mfaCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    mfaRecoveryCode: z
      .string()
      .trim()
      .regex(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/i)
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .refine((value) => !(value.mfaCode && value.mfaRecoveryCode), {
    message: "Provide either a TOTP code or a recovery code, not both.",
  });

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const offlineAccessPolicySchema = z.object({
  enabled: z.boolean(),
  leaseExpiresAt: z.string().datetime().nullable(),
  minimumPinLength: z.number().int().min(6).max(12),
  maximumFailedAttempts: z.number().int().min(3).max(10),
  lockoutSeconds: z.number().int().min(30).max(86_400),
});
export type OfflineAccessPolicy = z.infer<typeof offlineAccessPolicySchema>;

export const offlineUnlockEnrollmentRequestSchema = z.object({
  branchId: identifierSchema,
  reason: z.string().trim().min(1).max(500),
});
export type OfflineUnlockEnrollmentRequest = z.infer<
  typeof offlineUnlockEnrollmentRequestSchema
>;

export const loginResponseSchema = z.object({
  accessToken: z.string().min(32),
  expiresAt: z.string().datetime(),
  offlineAccess: offlineAccessPolicySchema,
  scope: z.object({
    organizationId: identifierSchema,
    branchId: identifierSchema,
    deviceId: identifierSchema,
  }),
  user: z.object({
    id: identifierSchema,
    displayName: z.string(),
    email: z.string().email(),
    permissions: z.array(z.string()),
    mustChangePassword: z.boolean(),
    mfaActive: z.boolean(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const createCategoryRequestSchema = z.object({
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  reason: z.string().trim().min(1).max(500),
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const categoryResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
export const categoryListResponseSchema = z.array(categoryResponseSchema);
export const stationKindSchema = z.enum(["KITCHEN", "BAR", "OTHER"]);

export const createStationRequestSchema = z.object({
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  kind: stationKindSchema,
  reason: z.string().trim().min(1).max(500),
});

export type CreateStationRequest = z.infer<typeof createStationRequestSchema>;

export const stationResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  name: z.string().min(1).max(100),
  kind: stationKindSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StationResponse = z.infer<typeof stationResponseSchema>;
export const stationListResponseSchema = z.array(stationResponseSchema);
export const createTaxClassRequestSchema = z.object({
  branchId: identifierSchema,
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/),
  label: z.string().trim().min(1).max(120),
  treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
  reason: z.string().trim().min(1).max(500),
});

export type CreateTaxClassRequest = z.infer<typeof createTaxClassRequestSchema>;

export const catalogRevisionCommandSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

export type CatalogRevisionCommand = z.infer<
  typeof catalogRevisionCommandSchema
>;

export const activateTaxClassRequestSchema =
  catalogRevisionCommandSchema.extend({
    reason: z.string().trim().min(1).max(500),
  });

export type ActivateTaxClassRequest = z.infer<
  typeof activateTaxClassRequestSchema
>;

export const deactivateCatalogRequestSchema =
  catalogRevisionCommandSchema.extend({
    reason: z.string().trim().min(1).max(500),
  });

export type DeactivateCatalogRequest = z.infer<
  typeof deactivateCatalogRequestSchema
>;

const availabilityFields = {
  isAvailable: z.boolean().default(true),
  unavailableFrom: z.string().datetime().nullable().optional(),
  unavailableTo: z.string().datetime().nullable().optional(),
  unavailableReason: z.string().trim().min(1).max(240).nullable().optional(),
};

export const createMenuItemRequestSchema = z.object({
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable().optional(),
  categoryId: identifierSchema,
  defaultStationId: identifierSchema.nullable().optional(),
  taxClassId: identifierSchema.nullable().optional(),
  name: z.string().trim().min(1).max(140),
  shortName: z.string().trim().min(1).max(40).nullable().optional(),
  description: z.string().trim().max(1_000).nullable().optional(),
  sku: z.string().trim().min(1).max(80).nullable().optional(),
  imageUrl: z.string().url().max(2_048).nullable().optional(),
  isActive: z.boolean().default(false),
  ...availabilityFields,
  reason: z.string().trim().min(1).max(500),
});

export type CreateMenuItemRequest = z.infer<typeof createMenuItemRequestSchema>;
export const updateMenuItemRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    categoryId: identifierSchema.optional(),
    defaultStationId: identifierSchema.nullable().optional(),
    taxClassId: identifierSchema.nullable().optional(),
    name: z.string().trim().min(1).max(140).optional(),
    shortName: z.string().trim().min(1).max(40).nullable().optional(),
    description: z.string().trim().max(1_000).nullable().optional(),
    sku: z.string().trim().min(1).max(80).nullable().optional(),
    imageUrl: z.string().url().max(2_048).nullable().optional(),
    isAvailable: z.boolean().optional(),
    unavailableFrom: z.string().datetime().nullable().optional(),
    unavailableTo: z.string().datetime().nullable().optional(),
    unavailableReason: z.string().trim().min(1).max(240).nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (value) =>
      Object.keys(value).some(
        (key) => key !== "branchId" && key !== "revision" && key !== "reason",
      ),
    { message: "At least one menu item field must be provided." },
  );

export type UpdateMenuItemRequest = z.infer<typeof updateMenuItemRequestSchema>;

export const createMenuVariantRequestSchema = z.object({
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  sku: z.string().trim().min(1).max(80).nullable().optional(),
  isActive: z.boolean().default(false),
  ...availabilityFields,
  reason: z.string().trim().min(1).max(500),
});

export type CreateMenuVariantRequest = z.infer<
  typeof createMenuVariantRequestSchema
>;

export const createModifierGroupRequestSchema = z
  .object({
    branchId: identifierSchema,
    name: z.string().trim().min(1).max(100),
    minimum: z.number().int().min(0).max(100).default(0),
    maximum: z.number().int().min(1).max(100).default(1),
    isRequired: z.boolean().default(false),
    freeSelectionCount: z.number().int().min(0).max(100).default(0),
    modifiers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          stationId: identifierSchema.nullable().optional(),
          priceDeltaMinor: z.number().int().min(0).max(10_000_000).default(0),
          ...availabilityFields,
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((value) => value.maximum >= value.minimum, {
    path: ["maximum"],
    message: "Maximum selections must be at least the minimum.",
  })
  .refine((value) => value.freeSelectionCount <= value.maximum, {
    path: ["freeSelectionCount"],
    message: "Free selections cannot exceed the maximum selections.",
  })
  .refine((value) => !value.isRequired || value.minimum > 0, {
    path: ["minimum"],
    message: "A required group must require at least one selection.",
  });

export type CreateModifierGroupRequest = z.infer<
  typeof createModifierGroupRequestSchema
>;

export const createMenuPriceRequestSchema = z
  .object({
    branchId: identifierSchema,
    menuItemId: identifierSchema,
    menuVariantId: identifierSchema.nullable().optional(),
    amountMinor: z.number().int().positive().max(2_000_000_000),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (value) =>
      !value.effectiveTo ||
      new Date(value.effectiveTo).getTime() >
        new Date(value.effectiveFrom).getTime(),
    {
      path: ["effectiveTo"],
      message: "The effective end must be after the start.",
    },
  );

export type CreateMenuPriceRequest = z.infer<
  typeof createMenuPriceRequestSchema
>;

export const attachModifierGroupRequestSchema = z.object({
  branchId: identifierSchema,
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  reason: z.string().trim().min(1).max(500),
});

export type AttachModifierGroupRequest = z.infer<
  typeof attachModifierGroupRequestSchema
>;

export const taxClassResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxClassResponse = z.infer<typeof taxClassResponseSchema>;
export const taxClassListResponseSchema = z.array(taxClassResponseSchema);

export const menuPriceResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  menuItemId: identifierSchema,
  menuVariantId: identifierSchema.nullable(),
  amountMinor: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MenuPriceResponse = z.infer<typeof menuPriceResponseSchema>;

const catalogAvailabilityResponseFields = {
  isAvailable: z.boolean(),
  unavailableFrom: z.string().datetime().nullable(),
  unavailableTo: z.string().datetime().nullable(),
  unavailableReason: z.string().nullable(),
};

export const menuVariantResponseSchema = z.object({
  id: identifierSchema,
  menuItemId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  name: z.string().min(1),
  sku: z.string().nullable(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  ...catalogAvailabilityResponseFields,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MenuVariantResponse = z.infer<typeof menuVariantResponseSchema>;

export const menuModifierResponseSchema = z.object({
  id: identifierSchema,
  modifierGroupId: identifierSchema,
  stationId: identifierSchema.nullable(),
  name: z.string().min(1),
  priceDeltaMinor: z.number().int().nonnegative(),
  ...catalogAvailabilityResponseFields,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MenuModifierResponse = z.infer<typeof menuModifierResponseSchema>;

export const modifierGroupResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  name: z.string().min(1),
  minimum: z.number().int().nonnegative(),
  maximum: z.number().int().positive(),
  isRequired: z.boolean(),
  freeSelectionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  modifiers: z.array(menuModifierResponseSchema),
});
export type ModifierGroupResponse = z.infer<typeof modifierGroupResponseSchema>;
export const modifierGroupListResponseSchema = z.array(
  modifierGroupResponseSchema,
);

export const menuItemBaseResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  categoryId: identifierSchema,
  defaultStationId: identifierSchema.nullable(),
  taxClassId: identifierSchema.nullable(),
  name: z.string().min(1),
  shortName: z.string().nullable(),
  description: z.string().nullable(),
  sku: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  ...catalogAvailabilityResponseFields,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MenuItemBaseResponse = z.infer<typeof menuItemBaseResponseSchema>;

export const menuItemConfigurationResponseSchema =
  menuItemBaseResponseSchema.extend({
    category: categoryResponseSchema,
    defaultStation: stationResponseSchema.nullable(),
    taxClass: taxClassResponseSchema.nullable(),
    variants: z.array(
      menuVariantResponseSchema.extend({
        prices: z.array(menuPriceResponseSchema),
      }),
    ),
    prices: z.array(menuPriceResponseSchema),
    modifierGroups: z.array(
      z.object({
        menuItemId: identifierSchema,
        modifierGroupId: identifierSchema,
        sortOrder: z.number().int().nonnegative(),
        modifierGroup: modifierGroupResponseSchema,
      }),
    ),
  });
export type MenuItemConfigurationResponse = z.infer<
  typeof menuItemConfigurationResponseSchema
>;
export const menuItemConfigurationListResponseSchema = z.array(
  menuItemConfigurationResponseSchema,
);
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("base-cafe-api"),
  version: z.string(),
  timestamp: z.string().datetime(),
  database: z.enum(["up", "down"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
