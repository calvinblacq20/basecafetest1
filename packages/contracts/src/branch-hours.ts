import { z } from "zod";

const identifierSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1).max(500);
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, "Must be a valid YYYY-MM-DD local date.");

export const serviceWindowInputSchema = z.object({
  opensAtMinute: z.number().int().min(0).max(1_439),
  durationMinutes: z.number().int().min(1).max(1_440),
});

export const weeklyServiceWindowInputSchema = serviceWindowInputSchema.extend({
  isoWeekday: z.number().int().min(1).max(7),
});

export const createBranchScheduleRequestSchema = z.object({
  branchId: identifierSchema,
  effectiveFrom: localDateSchema,
  businessDayCutoffMinute: z.number().int().min(0).max(1_439),
  windows: z.array(weeklyServiceWindowInputSchema).max(100),
  reason: reasonSchema,
});

export type CreateBranchScheduleRequest = z.infer<
  typeof createBranchScheduleRequestSchema
>;

export const updateBranchScheduleRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    effectiveFrom: localDateSchema.optional(),
    businessDayCutoffMinute: z.number().int().min(0).max(1_439).optional(),
    windows: z.array(weeklyServiceWindowInputSchema).max(100).optional(),
    reason: reasonSchema,
  })
  .refine(
    (value) =>
      value.effectiveFrom !== undefined ||
      value.businessDayCutoffMinute !== undefined ||
      value.windows !== undefined,
    "At least one schedule field must be changed.",
  );

export type UpdateBranchScheduleRequest = z.infer<
  typeof updateBranchScheduleRequestSchema
>;

export const branchScheduleLifecycleRequestSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  reason: reasonSchema,
});

export type BranchScheduleLifecycleRequest = z.infer<
  typeof branchScheduleLifecycleRequestSchema
>;

export const specialHoursKindSchema = z.enum(["CLOSED", "CUSTOM_HOURS"]);

function validateSpecialHours(
  value: {
    kind?: "CLOSED" | "CUSTOM_HOURS";
    windows?: readonly unknown[];
  },
  context: z.RefinementCtx,
) {
  if (value.kind === "CLOSED" && value.windows && value.windows.length > 0) {
    context.addIssue({
      code: "custom",
      message: "A closed special day cannot contain service windows.",
      path: ["windows"],
    });
  }
  if (
    value.kind === "CUSTOM_HOURS" &&
    value.windows &&
    value.windows.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Custom special hours require at least one service window.",
      path: ["windows"],
    });
  }
}

export const createSpecialHoursRequestSchema = z
  .object({
    branchId: identifierSchema,
    localDate: localDateSchema,
    kind: specialHoursKindSchema,
    label: z.string().trim().min(1).max(120).nullable().optional(),
    windows: z.array(serviceWindowInputSchema).max(20),
    reason: reasonSchema,
  })
  .superRefine(validateSpecialHours);

export type CreateSpecialHoursRequest = z.infer<
  typeof createSpecialHoursRequestSchema
>;

export const updateSpecialHoursRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    localDate: localDateSchema.optional(),
    kind: specialHoursKindSchema.optional(),
    label: z.string().trim().min(1).max(120).nullable().optional(),
    windows: z.array(serviceWindowInputSchema).max(20).optional(),
    reason: reasonSchema,
  })
  .superRefine((value, context) => {
    validateSpecialHours(value, context);
    if (
      value.localDate === undefined &&
      value.kind === undefined &&
      value.label === undefined &&
      value.windows === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "At least one special-hours field must be changed.",
      });
    }
  });

export type UpdateSpecialHoursRequest = z.infer<
  typeof updateSpecialHoursRequestSchema
>;

export const resolveBranchHoursPreviewRequestSchema = z.object({
  branchId: identifierSchema,
  instant: z.string().datetime(),
});

export type ResolveBranchHoursPreviewRequest = z.infer<
  typeof resolveBranchHoursPreviewRequestSchema
>;

const storedWindowSchema = serviceWindowInputSchema.extend({
  id: identifierSchema,
});

const storedWeeklyWindowSchema = storedWindowSchema.extend({
  scheduleId: identifierSchema,
  isoWeekday: z.number().int().min(1).max(7),
});

export const branchScheduleResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  createdById: identifierSchema,
  activatedById: identifierSchema.nullable(),
  endedById: identifierSchema.nullable(),
  effectiveFrom: z.string().datetime(),
  businessDayCutoffMinute: z.number().int().min(0).max(1_439),
  status: z.enum(["DRAFT", "ACTIVE", "CANCELLED"]),
  revision: z.number().int().positive(),
  activatedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  windows: z.array(storedWeeklyWindowSchema),
});

export type BranchScheduleResponse = z.infer<
  typeof branchScheduleResponseSchema
>;

export const specialHoursResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  createdById: identifierSchema,
  activatedById: identifierSchema.nullable(),
  endedById: identifierSchema.nullable(),
  localDate: z.string().datetime(),
  kind: specialHoursKindSchema,
  label: z.string().max(120).nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "CANCELLED", "SUPERSEDED"]),
  revision: z.number().int().positive(),
  activatedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  windows: z.array(
    storedWindowSchema.extend({ specialHoursId: identifierSchema }),
  ),
});

export type SpecialHoursResponse = z.infer<typeof specialHoursResponseSchema>;

export const branchHoursConfigurationResponseSchema = z.object({
  schedules: z.array(branchScheduleResponseSchema),
  specialHours: z.array(specialHoursResponseSchema),
});

export type BranchHoursConfigurationResponse = z.infer<
  typeof branchHoursConfigurationResponseSchema
>;

const resolvedActiveWindowSchema = z.object({
  anchorDate: localDateSchema,
  scheduleVersionId: identifierSchema.nullable(),
  specialHoursId: identifierSchema.nullable(),
  source: z.enum([
    "WEEKLY",
    "SPECIAL_CLOSED",
    "SPECIAL_CUSTOM",
    "UNCONFIGURED",
  ]),
  opensAtMinute: z.number().int().min(0).max(1_439),
  durationMinutes: z.number().int().min(1).max(1_440),
  elapsedMinutes: z.number().int().min(0),
});

export const branchHoursPreviewResponseSchema = z.object({
  branchId: identifierSchema,
  timezone: z.string().min(1),
  instant: z.string().datetime(),
  local: z.object({
    localDate: localDateSchema,
    localTime: z.string().regex(/^\d{2}:\d{2}$/),
    minuteOfDay: z.number().int().min(0).max(1_439),
    isoWeekday: z.number().int().min(1).max(7),
  }),
  configurationReady: z.boolean(),
  businessDate: localDateSchema.nullable(),
  businessDayCutoffMinute: z.number().int().min(0).max(1_439).optional(),
  scheduleVersionId: identifierSchema.nullable(),
  isOpen: z.boolean(),
  activeWindow: resolvedActiveWindowSchema.nullable(),
  currentSource: z.enum([
    "WEEKLY",
    "SPECIAL_CLOSED",
    "SPECIAL_CUSTOM",
    "UNCONFIGURED",
  ]),
  issues: z.array(z.object({ code: z.literal("CONFIGURATION_MISSING") })),
});

export type BranchHoursPreviewResponse = z.infer<
  typeof branchHoursPreviewResponseSchema
>;
