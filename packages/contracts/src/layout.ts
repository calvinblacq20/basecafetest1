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
const displayOrderSchema = z.number().int().min(0).max(100_000);
const coordinateSchema = z.number().int().min(0).max(10_000).nullable();

export const createDiningAreaRequestSchema = z.object({
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  displayOrder: displayOrderSchema.default(0),
  reason: reasonSchema,
});

export type CreateDiningAreaRequest = z.infer<
  typeof createDiningAreaRequestSchema
>;

export const updateDiningAreaRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    reason: reasonSchema,
    name: z.string().trim().min(1).max(100).optional(),
    displayOrder: displayOrderSchema.optional(),
  })
  .refine(
    ({ name, displayOrder }) =>
      name !== undefined || displayOrder !== undefined,
    { message: "At least one dining-area field must be changed." },
  );

export type UpdateDiningAreaRequest = z.infer<
  typeof updateDiningAreaRequestSchema
>;

export const createDiningTableRequestSchema = z
  .object({
    branchId: identifierSchema,
    diningAreaId: identifierSchema,
    externalKey: externalKeySchema.nullable().optional(),
    name: z.string().trim().min(1).max(100),
    capacity: z.number().int().min(1).max(1_000),
    combinableGroup: externalKeySchema.nullable().optional(),
    displayOrder: displayOrderSchema.default(0),
    positionX: coordinateSchema.optional(),
    positionY: coordinateSchema.optional(),
    reason: reasonSchema,
  })
  .refine(
    ({ positionX, positionY }) =>
      (positionX == null && positionY == null) ||
      (typeof positionX === "number" && typeof positionY === "number"),
    { message: "Floor-plan X and Y coordinates must be supplied together." },
  );

export type CreateDiningTableRequest = z.infer<
  typeof createDiningTableRequestSchema
>;

export const updateDiningTableRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    reason: reasonSchema,
    diningAreaId: identifierSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    capacity: z.number().int().min(1).max(1_000).optional(),
    combinableGroup: externalKeySchema.nullable().optional(),
    displayOrder: displayOrderSchema.optional(),
    positionX: coordinateSchema.optional(),
    positionY: coordinateSchema.optional(),
  })
  .refine(
    ({
      diningAreaId,
      name,
      capacity,
      combinableGroup,
      displayOrder,
      positionX,
      positionY,
    }) =>
      diningAreaId !== undefined ||
      name !== undefined ||
      capacity !== undefined ||
      combinableGroup !== undefined ||
      displayOrder !== undefined ||
      positionX !== undefined ||
      positionY !== undefined,
    { message: "At least one dining-table field must be changed." },
  )
  .refine(
    ({ positionX, positionY }) => {
      const xProvided = positionX !== undefined;
      const yProvided = positionY !== undefined;
      return (
        (!xProvided && !yProvided) ||
        (xProvided &&
          yProvided &&
          ((positionX === null && positionY === null) ||
            (typeof positionX === "number" && typeof positionY === "number")))
      );
    },
    { message: "Floor-plan X and Y coordinates must be changed together." },
  );

export type UpdateDiningTableRequest = z.infer<
  typeof updateDiningTableRequestSchema
>;

export const layoutLifecycleRequestSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  reason: reasonSchema,
});

export type LayoutLifecycleRequest = z.infer<
  typeof layoutLifecycleRequestSchema
>;

export const diningTableResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  diningAreaId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  name: z.string().min(1).max(100),
  capacity: z.number().int().min(1),
  combinableGroup: externalKeySchema.nullable(),
  displayOrder: displayOrderSchema,
  positionX: coordinateSchema,
  positionY: coordinateSchema,
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DiningTableResponse = z.infer<typeof diningTableResponseSchema>;

export const diningAreaBaseResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  externalKey: externalKeySchema.nullable(),
  name: z.string().min(1).max(100),
  displayOrder: displayOrderSchema,
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const diningAreaResponseSchema = diningAreaBaseResponseSchema.extend({
  tables: z.array(diningTableResponseSchema),
});

export type DiningAreaResponse = z.infer<typeof diningAreaResponseSchema>;
export const diningAreaListResponseSchema = z.array(diningAreaResponseSchema);

export const diningTableWithAreaResponseSchema =
  diningTableResponseSchema.extend({
    diningArea: diningAreaBaseResponseSchema,
  });

export type DiningTableWithAreaResponse = z.infer<
  typeof diningTableWithAreaResponseSchema
>;
export const diningTableListResponseSchema = z.array(
  diningTableWithAreaResponseSchema,
);
