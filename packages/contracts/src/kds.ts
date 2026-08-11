import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const preparationTicketStatusSchema = z.enum([
  "QUEUED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "CANCELLED",
]);
export type PreparationTicketStatus = z.infer<
  typeof preparationTicketStatusSchema
>;

export const kdsStationResponseSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  kind: z.enum(["KITCHEN", "BAR", "OTHER"]),
});
export type KdsStationResponse = z.infer<typeof kdsStationResponseSchema>;

export const preparationModifierSummarySchema = z.object({
  name: z.string().min(1).max(100),
  group: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
});

export const preparationTicketEntryResponseSchema = z.object({
  id,
  orderLineId: id,
  kind: z.enum(["ITEM", "MODIFIER"]),
  quantity: z.number().int().positive(),
  itemName: z.string().min(1).max(140),
  variantName: z.string().max(100).nullable(),
  modifierName: z.string().max(100).nullable(),
  modifierGroup: z.string().max(100).nullable(),
  modifierSummary: z.array(preparationModifierSummarySchema),
  note: z.string().max(500).nullable(),
  cancelledAt: z.string().datetime().nullable(),
});
export type PreparationTicketEntryResponse = z.infer<
  typeof preparationTicketEntryResponseSchema
>;

export const preparationTicketResponseSchema = z.object({
  id,
  branchId: id,
  stationId: id,
  stationName: z.string().min(1).max(100),
  orderId: id,
  sendWaveId: id,
  waveNumber: z.number().int().positive(),
  status: preparationTicketStatusSchema,
  revision: z.number().int().positive(),
  orderNumber: z.string().min(1).max(32),
  channel: z.enum(["DINE_IN", "TAKEAWAY", "PHONE_DELIVERY", "BAR_TAB"]),
  serviceReference: z.string().max(160).nullable(),
  cashierName: z.string().min(1).max(120),
  businessDate: z.string().date(),
  queuedAt: z.string().datetime(),
  preparingAt: z.string().datetime().nullable(),
  readyAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  entries: z.array(preparationTicketEntryResponseSchema),
});
export type PreparationTicketResponse = z.infer<
  typeof preparationTicketResponseSchema
>;

export const preparationTicketListResponseSchema = z.array(
  preparationTicketResponseSchema,
);
export const kdsStationListResponseSchema = z.array(kdsStationResponseSchema);

export const sendOrderWaveRequestSchema = z
  .object({
    branchId: id,
    orderRevision: z.number().int().positive(),
    sendWaveId: id,
    lineIds: z.array(id).min(1).max(100),
    reason,
  })
  .refine((value) => new Set(value.lineIds).size === value.lineIds.length, {
    path: ["lineIds"],
    message: "Send-wave line IDs must be unique.",
  });
export type SendOrderWaveRequest = z.infer<typeof sendOrderWaveRequestSchema>;

export const cancelSentOrderLineRequestSchema = z.object({
  branchId: id,
  orderRevision: z.number().int().positive(),
  cancellationId: id,
  reason,
});
export type CancelSentOrderLineRequest = z.infer<
  typeof cancelSentOrderLineRequestSchema
>;

export const preparationTicketQuerySchema = z.object({
  stationId: id.optional(),
  status: preparationTicketStatusSchema.optional(),
  businessDate: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type PreparationTicketQuery = z.infer<
  typeof preparationTicketQuerySchema
>;

export const transitionPreparationTicketRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type TransitionPreparationTicketRequest = z.infer<
  typeof transitionPreparationTicketRequestSchema
>;
