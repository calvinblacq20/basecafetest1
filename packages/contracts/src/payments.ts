import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);
const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();

export const paymentMethodSchema = z.enum([
  "CASH",
  "MANUAL_MOMO",
  "EXTERNAL_CARD",
  "BANK_TRANSFER",
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentStatusSchema = z.enum([
  "PENDING",
  "REQUIRES_VERIFICATION",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentAllocationInputSchema = z.object({
  allocationId: id,
  orderId: id,
  amountMinor: z.number().int().positive().max(2_000_000_000),
});

export const createPaymentRequestSchema = z
  .object({
    paymentId: id,
    branchId: id,
    shiftId: id,
    method: paymentMethodSchema,
    amountMinor: z.number().int().positive().max(2_000_000_000),
    tenderedAmountMinor: z
      .number()
      .int()
      .positive()
      .max(2_000_000_000)
      .optional(),
    externalReference: optionalText(160),
    network: optionalText(80),
    merchantAccountReference: optionalText(120),
    evidenceNote: optionalText(500),
    allocations: z.array(paymentAllocationInputSchema).min(1).max(100),
    reason,
  })
  .superRefine((value, context) => {
    const total = value.allocations.reduce(
      (sum, allocation) => sum + allocation.amountMinor,
      0,
    );
    if (!Number.isSafeInteger(total) || total !== value.amountMinor)
      context.addIssue({
        code: "custom",
        path: ["allocations"],
        message:
          "Payment allocations must reconcile exactly to the payment amount.",
      });
    const orderIds = new Set<string>();
    const allocationIds = new Set<string>();
    value.allocations.forEach((allocation, index) => {
      if (orderIds.has(allocation.orderId))
        context.addIssue({
          code: "custom",
          path: ["allocations", index, "orderId"],
          message: "An order may appear only once in a payment allocation.",
        });
      if (allocationIds.has(allocation.allocationId))
        context.addIssue({
          code: "custom",
          path: ["allocations", index, "allocationId"],
          message: "Allocation IDs must be unique.",
        });
      orderIds.add(allocation.orderId);
      allocationIds.add(allocation.allocationId);
    });
    if (value.method === "CASH") {
      if (value.tenderedAmountMinor === undefined)
        context.addIssue({
          code: "custom",
          path: ["tenderedAmountMinor"],
          message: "Cash requires the amount tendered.",
        });
      else if (value.tenderedAmountMinor < value.amountMinor)
        context.addIssue({
          code: "custom",
          path: ["tenderedAmountMinor"],
          message: "Cash tendered cannot be less than the payment amount.",
        });
      if (value.externalReference)
        context.addIssue({
          code: "custom",
          path: ["externalReference"],
          message: "Cash must not use an electronic reference.",
        });
    } else {
      if (!value.externalReference)
        context.addIssue({
          code: "custom",
          path: ["externalReference"],
          message: "Non-cash manual tenders require an external reference.",
        });
      if (value.tenderedAmountMinor !== undefined)
        context.addIssue({
          code: "custom",
          path: ["tenderedAmountMinor"],
          message: "Tendered amount is only valid for cash.",
        });
    }
  });
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const paymentListQuerySchema = z.object({
  orderId: id.optional(),
  shiftId: id.optional(),
  method: paymentMethodSchema.optional(),
  status: paymentStatusSchema.optional(),
  externalReference: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const paymentAllocationResponseSchema = z.object({
  id,
  orderId: id,
  amountMinor: z.number().int().positive(),
  order: z.object({
    orderNumber: z.string().min(1),
    grossTotalMinor: z.number().int().nonnegative(),
  }),
});

export const paymentVerificationResponseSchema = z.object({
  id,
  verifierId: id,
  verifierDisplayName: z.string().min(1),
  decision: z.enum(["CONFIRM", "FAIL"]),
  evidenceNote: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().datetime(),
});

/**
 * Stable, POS-safe payment projection. Provider/account fields and event data
 * stay server-side; the cashier receives only what is required to reconcile
 * and independently verify a tender.
 */
export const paymentResponseSchema = z.object({
  id,
  branchId: id,
  orderId: id,
  shiftId: id,
  createdById: id,
  createdByDisplayName: z.string().min(1),
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  currency: z.literal("GHS"),
  amountMinor: z.number().int().positive(),
  tenderedAmountMinor: z.number().int().positive().nullable(),
  changeMinor: z.number().int().nonnegative(),
  externalReference: z.string().nullable(),
  evidenceNote: z.string().nullable(),
  revision: z.number().int().positive(),
  confirmedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  allocations: z.array(paymentAllocationResponseSchema),
  verification: paymentVerificationResponseSchema.nullable(),
});
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

export const paymentListResponseSchema = z.array(paymentResponseSchema);
export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;

export const verifyManualPaymentRequestSchema = z.object({
  verificationId: id,
  branchId: id,
  revision: z.number().int().positive(),
  decision: z.enum(["CONFIRM", "FAIL"]),
  evidenceNote: z.string().trim().min(1).max(500),
  reason,
});
export type VerifyManualPaymentRequest = z.infer<
  typeof verifyManualPaymentRequestSchema
>;

export const cancelPaymentRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type CancelPaymentRequest = z.infer<typeof cancelPaymentRequestSchema>;

export const completeOrderRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type CompleteOrderRequest = z.infer<typeof completeOrderRequestSchema>;

export const completeOrderResponseSchema = z.object({
  orderId: id,
  status: z.literal("COMPLETED"),
  revision: z.number().int().positive(),
  completedAt: z.string().datetime(),
  confirmedTotalMinor: z.number().int().nonnegative(),
  compositionOrderIds: z.array(id),
  inventory: z.unknown(),
});
export type CompleteOrderResponse = z.infer<typeof completeOrderResponseSchema>;
