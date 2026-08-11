import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);
const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

export const orderChannelSchema = z.enum([
  "DINE_IN",
  "TAKEAWAY",
  "PHONE_DELIVERY",
  "BAR_TAB",
]);
export type OrderChannel = z.infer<typeof orderChannelSchema>;
export const orderStatusSchema = z.enum([
  "OPEN",
  "HELD",
  "CANCELLED",
  "MERGED",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export const orderLineStatusSchema = z.enum([
  "DRAFT",
  "REPLACED",
  "REMOVED",
  "CANCELLED",
]);
export type OrderLineStatus = z.infer<typeof orderLineStatusSchema>;

export const createOrderRequestSchema = z
  .object({
    orderId: id,
    branchId: id,
    shiftId: id,
    clientReference: z.string().trim().min(1).max(64),
    channel: orderChannelSchema,
    tableId: id.nullable().optional(),
    guestCount: z.number().int().min(1).max(100).nullable().optional(),
    pickupReference: optionalText(120),
    customerId: id.nullable().optional(),
    customerReference: optionalText(120),
    customerPhone: optionalText(40),
    deliveryDirections: optionalText(500),
    tabName: optionalText(120),
    note: optionalText(1_000),
    allowTableConflict: z.boolean().default(false),
    reason,
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (value.channel === "PHONE_DELIVERY" && !value.customerReference)
      issue(
        "customerReference",
        "Phone delivery requires a customer reference.",
      );
    if (value.channel === "BAR_TAB" && !value.tabName)
      issue("tabName", "A bar tab requires a tab name.");
    if (!["DINE_IN", "BAR_TAB"].includes(value.channel) && value.tableId)
      issue("tableId", "Only dine-in and bar-tab orders can attach a table.");
    if (value.channel !== "DINE_IN" && value.guestCount)
      issue("guestCount", "Guest count is only valid for dine-in orders.");
    if (value.channel !== "BAR_TAB" && value.tabName)
      issue("tabName", "Tab name is only valid for bar-tab orders.");
    if (
      value.channel !== "PHONE_DELIVERY" &&
      (value.customerPhone || value.deliveryDirections)
    )
      issue(
        "customerPhone",
        "Delivery fields are only valid for phone delivery.",
      );
    if (value.channel !== "TAKEAWAY" && value.pickupReference)
      issue(
        "pickupReference",
        "Pickup reference is only valid for takeaway orders.",
      );
  });
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  channel: orderChannelSchema.optional(),
  businessDate: z.string().date().optional(),
  orderNumber: z.string().trim().min(1).max(32).optional(),
  clientReference: z.string().trim().min(1).max(64).optional(),
  tableId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderListItemResponseSchema = z.object({
  id,
  orderNumber: z.string().min(1),
  clientReference: z.string().min(1),
  channel: orderChannelSchema,
  status: orderStatusSchema,
  revision: z.number().int().positive(),
  businessDate: z.string().date(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  table: z.object({ id, name: z.string().min(1) }).nullable(),
  assignedServer: z.object({ id, displayName: z.string().min(1) }),
  guestCount: z.number().int().positive().nullable(),
  pickupReference: z.string().nullable(),
  customerReference: z.string().nullable(),
  tabName: z.string().nullable(),
  activeLineCount: z.number().int().nonnegative(),
  grossTotalMinor: z.number().int().nonnegative(),
});
export type OrderListItemResponse = z.infer<typeof orderListItemResponseSchema>;
export const orderListResponseSchema = z.array(orderListItemResponseSchema);
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderOperationDetailResponseSchema = z.object({
  id,
  orderNumber: z.string().min(1),
  clientReference: z.string().min(1),
  channel: orderChannelSchema,
  status: orderStatusSchema,
  revision: z.number().int().positive(),
  businessDate: z.string().datetime(),
  createdAt: z.string().datetime(),
  table: z.object({ id, name: z.string().min(1) }).nullable(),
  assignedServer: z.object({ id, displayName: z.string().min(1) }),
  guestCount: z.number().int().positive().nullable(),
  pickupReference: z.string().nullable(),
  customerReference: z.string().nullable(),
  tabName: z.string().nullable(),
  grossTotalMinor: z.number().int().nonnegative(),
  lines: z.array(
    z.object({
      id,
      status: orderLineStatusSchema,
      itemNameSnapshot: z.string().min(1),
      variantNameSnapshot: z.string().nullable(),
      quantity: z.number().int().positive(),
      grossAmountMinor: z.number().int().nonnegative(),
      sentAt: z.string().datetime().nullable(),
    }),
  ),
});
export type OrderOperationDetailResponse = z.infer<
  typeof orderOperationDetailResponseSchema
>;

export const orderOperationOptionsResponseSchema = z.object({
  staff: z.array(
    z.object({
      id,
      displayName: z.string().min(1),
    }),
  ),
});
export type OrderOperationOptionsResponse = z.infer<
  typeof orderOperationOptionsResponseSchema
>;

export const orderRevisionRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type OrderRevisionRequest = z.infer<typeof orderRevisionRequestSchema>;

export const orderModifierSelectionSchema = z.object({
  lineModifierId: id,
  modifierId: id,
  quantity: z.number().int().min(1).max(50).default(1),
});
export type OrderModifierSelection = z.infer<
  typeof orderModifierSelectionSchema
>;

const lineFields = {
  branchId: id,
  orderRevision: z.number().int().positive(),
  menuItemId: id,
  variantId: id.nullable().optional(),
  quantity: z.number().int().min(1).max(99),
  note: optionalText(500),
  modifiers: z.array(orderModifierSelectionSchema).max(100).default([]),
  reason,
};
export const addOrderLineRequestSchema = z.object({
  lineId: id,
  replacesCancelledLineId: id.optional(),
  ...lineFields,
});
export type AddOrderLineRequest = z.infer<typeof addOrderLineRequestSchema>;
export const replaceOrderLineRequestSchema = z.object({
  replacementLineId: id,
  ...lineFields,
});
export type ReplaceOrderLineRequest = z.infer<
  typeof replaceOrderLineRequestSchema
>;
export const removeOrderLineRequestSchema = z.object({
  branchId: id,
  orderRevision: z.number().int().positive(),
  reason,
});
export type RemoveOrderLineRequest = z.infer<
  typeof removeOrderLineRequestSchema
>;

export const moveOrderTableRequestSchema = z.object({
  operationId: id,
  branchId: id,
  revision: z.number().int().positive(),
  tableId: id.nullable(),
  allowTableConflict: z.boolean().default(false),
  reason,
});
export type MoveOrderTableRequest = z.infer<typeof moveOrderTableRequestSchema>;

export const transferOrderResponsibilityRequestSchema = z.object({
  operationId: id,
  branchId: id,
  revision: z.number().int().positive(),
  receivingUserId: id,
  reason,
});
export type TransferOrderResponsibilityRequest = z.infer<
  typeof transferOrderResponsibilityRequestSchema
>;

export const mergeOrdersRequestSchema = z.object({
  mergeId: id,
  branchId: id,
  targetRevision: z.number().int().positive(),
  sourceOrderId: id,
  sourceRevision: z.number().int().positive(),
  reason,
});
export type MergeOrdersRequest = z.infer<typeof mergeOrdersRequestSchema>;

export const splitOrderLineSelectionSchema = z.object({
  sourceLineId: id,
  targetLineId: id,
  quantity: z.number().int().min(1).max(99),
  remainderLineId: id.optional(),
});
export type SplitOrderLineSelection = z.infer<
  typeof splitOrderLineSelectionSchema
>;

export const splitOrderRequestSchema = z
  .object({
    splitId: id,
    branchId: id,
    sourceRevision: z.number().int().positive(),
    newOrderId: id,
    newClientReference: z.string().trim().min(1).max(64),
    tableId: id.nullable().optional(),
    allowTableConflict: z.boolean().default(false),
    lines: z.array(splitOrderLineSelectionSchema).min(1).max(100),
    reason,
  })
  .superRefine((value, context) => {
    const sourceIds = new Set<string>();
    const resultIds = new Set<string>();
    value.lines.forEach((line, index) => {
      if (resultIds.has(line.sourceLineId))
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sourceLineId"],
          message: "A source line ID cannot reuse a result line ID.",
        });
      if (sourceIds.has(line.sourceLineId))
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sourceLineId"],
          message: "Each source line may be split only once per command.",
        });
      sourceIds.add(line.sourceLineId);
      for (const [field, candidate] of [
        ["targetLineId", line.targetLineId],
        ["remainderLineId", line.remainderLineId],
      ] as const) {
        if (!candidate) continue;
        if (resultIds.has(candidate) || sourceIds.has(candidate))
          context.addIssue({
            code: "custom",
            path: ["lines", index, field],
            message: "Split result line IDs must be unique.",
          });
        resultIds.add(candidate);
      }
    });
  });
export type SplitOrderRequest = z.infer<typeof splitOrderRequestSchema>;
