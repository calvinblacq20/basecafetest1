import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const refundKindSchema = z.enum([
  "REFUND",
  "REVERSAL",
  "CHARGEBACK",
  "DISPUTE",
]);
export type RefundKind = z.infer<typeof refundKindSchema>;

export const requestRefundSchema = z.object({
  refundId: id,
  branchId: id,
  shiftId: id,
  paymentRevision: z.number().int().positive(),
  kind: refundKindSchema.default("REFUND"),
  amountMinor: z.number().int().positive().max(2_000_000_000),
  evidenceNote: z.string().trim().min(1).max(500),
  reason,
});
export type RequestRefund = z.infer<typeof requestRefundSchema>;

export const approveRefundSchema = z.object({
  approvalId: id,
  branchId: id,
  revision: z.number().int().positive(),
  decision: z.enum(["APPROVE", "REJECT"]),
  evidenceNote: z.string().trim().min(1).max(500),
  reason,
});
export type ApproveRefund = z.infer<typeof approveRefundSchema>;

export const resolveRefundSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  outcome: z.enum(["CONFIRMED", "FAILED"]),
  providerReference: z.string().trim().min(1).max(160),
  evidenceNote: z.string().trim().min(1).max(500),
  reason,
});
export type ResolveRefund = z.infer<typeof resolveRefundSchema>;

export const refundListQuerySchema = z.object({
  paymentId: id.optional(),
  orderId: id.optional(),
  shiftId: id.optional(),
  kind: refundKindSchema.optional(),
  status: z
    .enum([
      "AWAITING_APPROVAL",
      "PENDING_PROVIDER",
      "CONFIRMED",
      "FAILED",
      "REJECTED",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;

export const refundStatusSchema = z.enum([
  "AWAITING_APPROVAL",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "FAILED",
  "REJECTED",
]);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

export const refundApprovalResponseSchema = z.object({
  id,
  approverId: id,
  approverDisplayName: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  evidenceNote: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().datetime(),
});

/**
 * Stable operational refund projection. It intentionally excludes customer
 * details, payment account metadata, raw events, and rendered document HTML.
 */
export const refundResponseSchema = z.object({
  id,
  branchId: id,
  paymentId: id,
  orderId: id,
  shiftId: id,
  requestedById: id,
  requestedByDisplayName: z.string().min(1),
  resolvedById: id.nullable(),
  resolvedByDisplayName: z.string().min(1).nullable(),
  kind: refundKindSchema,
  status: refundStatusSchema,
  fiscalStatus: z.enum([
    "NOT_REQUIRED",
    "PENDING",
    "ISSUED",
    "FAILED",
    "OFFLINE_PENDING",
    "CANCELLED",
    "CREDIT_NOTE",
    "RECONCILED",
  ]),
  currency: z.literal("GHS"),
  amountMinor: z.number().int().positive(),
  evidenceNote: z.string().min(1),
  providerReference: z.string().min(1).nullable(),
  reason: z.string().min(1),
  revision: z.number().int().positive(),
  confirmedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  payment: z.object({
    method: z.enum(["CASH", "MANUAL_MOMO", "EXTERNAL_CARD", "BANK_TRANSFER"]),
    amountMinor: z.number().int().positive(),
  }),
  order: z.object({
    orderNumber: z.string().min(1),
    grossTotalMinor: z.number().int().nonnegative(),
  }),
  approval: refundApprovalResponseSchema.nullable(),
  document: z
    .object({
      id,
      label: z.literal("NOT A FISCAL CREDIT NOTE"),
      createdAt: z.string().datetime(),
    })
    .nullable(),
});
export type RefundResponse = z.infer<typeof refundResponseSchema>;

export const refundListResponseSchema = z.array(refundResponseSchema);
export type RefundListResponse = z.infer<typeof refundListResponseSchema>;
