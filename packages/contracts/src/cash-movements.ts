import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const cashMovementTypeSchema = z.enum([
  "PAID_IN",
  "PAID_OUT",
  "BANK_DROP",
  "CORRECTION",
]);
export type CashMovementType = z.infer<typeof cashMovementTypeSchema>;

export const requestCashMovementSchema = z
  .object({
    movementId: id,
    branchId: id,
    shiftId: id,
    shiftRevision: z.number().int().positive(),
    type: cashMovementTypeSchema,
    direction: z.enum(["IN", "OUT"]),
    amountMinor: z.number().int().positive().max(2_000_000_000),
    correctsMovementId: id.nullable().optional(),
    reference: z.string().trim().min(1).max(160).nullable().optional(),
    evidenceNote: z.string().trim().min(1).max(500),
    reason,
  })
  .superRefine((value, context) => {
    if (value.type === "PAID_IN" && value.direction !== "IN") {
      context.addIssue({
        code: "custom",
        path: ["direction"],
        message: "Paid-in must increase drawer cash.",
      });
    }
    if (
      ["PAID_OUT", "BANK_DROP"].includes(value.type) &&
      value.direction !== "OUT"
    ) {
      context.addIssue({
        code: "custom",
        path: ["direction"],
        message: "Paid-out and bank drop must reduce drawer cash.",
      });
    }
    if (value.type === "CORRECTION" && !value.correctsMovementId) {
      context.addIssue({
        code: "custom",
        path: ["correctsMovementId"],
        message: "A correction must reference the posted movement it corrects.",
      });
    }
    if (value.type !== "CORRECTION" && value.correctsMovementId) {
      context.addIssue({
        code: "custom",
        path: ["correctsMovementId"],
        message: "Only a correction may reference another cash movement.",
      });
    }
  });

export type RequestCashMovement = z.infer<typeof requestCashMovementSchema>;

export const approveCashMovementSchema = z.object({
  approvalId: id,
  branchId: id,
  revision: z.number().int().positive(),
  decision: z.enum(["APPROVE", "REJECT"]),
  evidenceNote: z.string().trim().min(1).max(500),
  reason,
});

export type ApproveCashMovement = z.infer<typeof approveCashMovementSchema>;

export const cashMovementListQuerySchema = z.object({
  shiftId: id.optional(),
  type: cashMovementTypeSchema.optional(),
  status: z.enum(["AWAITING_APPROVAL", "POSTED", "REJECTED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CashMovementListQuery = z.infer<typeof cashMovementListQuerySchema>;

export const cashMovementApprovalResponseSchema = z.object({
  id,
  approverId: id,
  approverDisplayName: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  evidenceNote: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().datetime(),
});

/**
 * Stable operational projection. It deliberately excludes device metadata,
 * raw audit/outbox payloads, and unrelated staff or customer information.
 */
export const cashMovementResponseSchema = z.object({
  id,
  branchId: id,
  shiftId: id,
  requestedById: id,
  requestedByDisplayName: z.string().min(1),
  type: cashMovementTypeSchema,
  direction: z.enum(["IN", "OUT"]),
  status: z.enum(["AWAITING_APPROVAL", "POSTED", "REJECTED"]),
  revision: z.number().int().positive(),
  currency: z.literal("GHS"),
  amountMinor: z.number().int().positive(),
  reference: z.string().min(1).nullable(),
  evidenceNote: z.string().min(1),
  reason: z.string().min(1),
  correctsMovement: z
    .object({
      id,
      type: cashMovementTypeSchema,
      direction: z.enum(["IN", "OUT"]),
      amountMinor: z.number().int().positive(),
      reference: z.string().min(1).nullable(),
    })
    .nullable(),
  approval: cashMovementApprovalResponseSchema.nullable(),
  postedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CashMovementResponse = z.infer<typeof cashMovementResponseSchema>;

export const cashMovementListResponseSchema = z.array(
  cashMovementResponseSchema,
);
export type CashMovementListResponse = z.infer<
  typeof cashMovementListResponseSchema
>;
