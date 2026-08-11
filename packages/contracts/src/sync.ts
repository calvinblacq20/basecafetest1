import { z } from "zod";

import { postInventoryConsumptionSchema } from "./inventory-consumption.js";
import { sendOrderWaveRequestSchema } from "./kds.js";
import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  orderRevisionRequestSchema,
  removeOrderLineRequestSchema,
  replaceOrderLineRequestSchema,
} from "./orders.js";
import {
  completeOrderRequestSchema,
  createPaymentRequestSchema,
} from "./payments.js";

const id = z.string().uuid();
const idempotencyKey = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const envelope = {
  commandId: id,
  branchId: id,
  deviceId: id,
  actorId: id,
  aggregateId: id,
  localSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.string().datetime({ offset: true }),
  schemaVersion: z.literal(1),
  idempotencyKey,
};

export const syncCommandSchema = z
  .discriminatedUnion("commandType", [
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_CREATE"),
      payload: createOrderRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_LINE_ADD"),
      payload: addOrderLineRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_LINE_REPLACE"),
      targetLineId: id,
      payload: replaceOrderLineRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_LINE_REMOVE"),
      targetLineId: id,
      payload: removeOrderLineRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_HOLD"),
      payload: orderRevisionRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_RESUME"),
      payload: orderRevisionRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_CANCEL"),
      payload: orderRevisionRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_SEND"),
      payload: sendOrderWaveRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("CASH_PAYMENT_CREATE"),
      payload: createPaymentRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("ORDER_COMPLETE"),
      payload: completeOrderRequestSchema,
    }),
    z.object({
      ...envelope,
      commandType: z.literal("INVENTORY_CONSUMPTION_POST"),
      payload: postInventoryConsumptionSchema,
    }),
  ])
  .superRefine((command, context) => {
    if (command.branchId !== command.payload.branchId)
      context.addIssue({
        code: "custom",
        path: ["payload", "branchId"],
        message: "The command and payload branch IDs must match.",
      });
    if (
      command.commandType === "ORDER_CREATE" &&
      command.aggregateId !== command.payload.orderId
    )
      context.addIssue({
        code: "custom",
        path: ["aggregateId"],
        message: "An order-create aggregate ID must equal its order ID.",
      });
    if (
      command.commandType === "CASH_PAYMENT_CREATE" &&
      command.payload.method !== "CASH"
    )
      context.addIssue({
        code: "custom",
        path: ["payload", "method"],
        message:
          "Offline electronic tender policy is not confirmed; only cash may use sync batching.",
      });
  });

export type SyncCommand = z.infer<typeof syncCommandSchema>;
export type SyncCommandType = SyncCommand["commandType"];

export const syncBatchRequestSchema = z
  .object({ commands: z.array(syncCommandSchema).min(1).max(25) })
  .superRefine(({ commands }, context) => {
    const ids = new Set<string>();
    let previous = 0;
    const first = commands[0];
    commands.forEach((command, index) => {
      if (
        first &&
        (command.branchId !== first.branchId ||
          command.deviceId !== first.deviceId ||
          command.actorId !== first.actorId)
      )
        context.addIssue({
          code: "custom",
          path: ["commands", index],
          message: "A batch must contain one branch, device, and actor scope.",
        });
      if (ids.has(command.commandId))
        context.addIssue({
          code: "custom",
          path: ["commands", index, "commandId"],
          message: "Command IDs must be unique within a batch.",
        });
      if (command.localSequence <= previous)
        context.addIssue({
          code: "custom",
          path: ["commands", index, "localSequence"],
          message: "Commands must be in strictly increasing local sequence.",
        });
      ids.add(command.commandId);
      previous = command.localSequence;
    });
  });

export type SyncBatchRequest = z.infer<typeof syncBatchRequestSchema>;

export const syncBootstrapResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  branch: z.object({
    id,
    name: z.string(),
    timezone: z.string(),
    currency: z.string().length(3),
  }),
  tables: z.array(
    z.object({
      id,
      areaId: id,
      areaName: z.string(),
      name: z.string(),
      capacity: z.number().int().positive().nullable(),
    }),
  ),
  shift: z
    .object({
      id,
      revision: z.number().int().positive(),
      businessDate: z.string().date(),
      currency: z.string().length(3),
      openingFloatMinor: z.number().int().nonnegative(),
    })
    .nullable(),
  taxProfile: z
    .object({
      id,
      name: z.string(),
      priceMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]),
      roundingMode: z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]),
      roundingScope: z.enum(["LINE", "INVOICE"]),
      components: z.array(
        z.object({
          id,
          code: z.string(),
          receiptLabel: z.string(),
          ratePpm: z.number().int().nonnegative(),
          calculationOrder: z.number().int().nonnegative(),
        }),
      ),
    })
    .nullable(),
  catalog: z.array(
    z.object({
      menuItemId: id,
      variantId: id.nullable(),
      name: z.string(),
      variantName: z.string().nullable(),
      categoryId: id,
      categoryName: z.string(),
      imageUrl: z.string().nullable(),
      priceMinor: z.number().int().nonnegative(),
      taxTreatment: z.enum([
        "STANDARD",
        "ZERO_RATED",
        "EXEMPT",
        "OUT_OF_SCOPE",
      ]),
      modifierGroups: z.array(
        z.object({
          id,
          name: z.string(),
          minimum: z.number().int().nonnegative(),
          maximum: z.number().int().positive(),
          freeSelectionCount: z.number().int().nonnegative(),
          modifiers: z.array(
            z.object({
              id,
              name: z.string(),
              priceDeltaMinor: z.number().int().nonnegative(),
            }),
          ),
        }),
      ),
    }),
  ),
  orders: z.array(
    z.object({
      id,
      orderNumber: z.string(),
      clientReference: z.string(),
      channel: z.enum(["DINE_IN", "TAKEAWAY", "PHONE_DELIVERY", "BAR_TAB"]),
      status: z.enum(["OPEN", "HELD"]),
      revision: z.number().int().positive(),
      tableId: id.nullable(),
      tableName: z.string().nullable(),
      guestCount: z.number().int().positive().nullable(),
      pickupReference: z.string().nullable(),
      customerReference: z.string().nullable(),
      tabName: z.string().nullable(),
      note: z.string().nullable(),
      inputSubtotalMinor: z.number().int().nonnegative(),
      netTotalMinor: z.number().int().nonnegative(),
      taxTotalMinor: z.number().int().nonnegative(),
      grossTotalMinor: z.number().int().nonnegative(),
      lines: z.array(
        z.object({
          id,
          menuItemId: id,
          variantId: id.nullable(),
          name: z.string(),
          variantName: z.string().nullable(),
          quantity: z.number().int().positive(),
          note: z.string().nullable(),
          baseUnitPriceMinor: z.number().int().nonnegative(),
          modifierUnitTotalMinor: z.number().int().nonnegative(),
          unitInputAmountMinor: z.number().int().nonnegative(),
          grossAmountMinor: z.number().int().nonnegative(),
          taxTreatment: z.enum([
            "STANDARD",
            "ZERO_RATED",
            "EXEMPT",
            "OUT_OF_SCOPE",
          ]),
          modifiers: z.array(
            z.object({
              id,
              modifierId: id,
              name: z.string(),
              quantity: z.number().int().positive(),
              configuredDeltaMinor: z.number().int(),
              chargedDeltaMinor: z.number().int(),
            }),
          ),
          sent: z.boolean(),
        }),
      ),
      tickets: z.array(
        z.object({
          id,
          stationName: z.string(),
          status: z.enum([
            "QUEUED",
            "PREPARING",
            "READY",
            "COMPLETED",
            "CANCELLED",
          ]),
          revision: z.number().int().positive(),
        }),
      ),
      confirmedPaymentMinor: z.number().int().nonnegative(),
    }),
  ),
});
export type SyncBootstrapResponse = z.infer<typeof syncBootstrapResponseSchema>;
export const syncResultStatusSchema = z.enum([
  "APPLIED",
  "REPLAYED",
  "CONFLICT",
  "REJECTED",
  "RETRYABLE",
  "DEPENDENCY_BLOCKED",
]);
export type SyncResultStatus = z.infer<typeof syncResultStatusSchema>;

export const syncCommandResultSchema = z.object({
  commandId: id,
  localSequence: z.number().int().positive(),
  status: syncResultStatusSchema,
  retryable: z.boolean(),
  code: z.string().min(1).max(120),
  serverReceivedAt: z.string().datetime(),
  clockSkewMs: z.number().int(),
  warnings: z.array(z.string().max(120)).max(10),
  response: z.unknown().optional(),
});
export type SyncCommandResult = z.infer<typeof syncCommandResultSchema>;

export const syncBatchResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  results: z.array(syncCommandResultSchema),
});
export type SyncBatchResponse = z.infer<typeof syncBatchResponseSchema>;

export const syncResolutionActionSchema = z.enum([
  "ACKNOWLEDGED_NO_ACTION",
  "SUPERSEDED_BY_COMMAND",
]);
export type SyncResolutionAction = z.infer<typeof syncResolutionActionSchema>;

export const resolveSyncCommandRequestSchema = z
  .object({
    branchId: id,
    action: syncResolutionActionSchema,
    successorCommandId: id.nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    const hasSuccessor = Boolean(value.successorCommandId);
    if (value.action === "SUPERSEDED_BY_COMMAND" && !hasSuccessor)
      context.addIssue({
        code: "custom",
        path: ["successorCommandId"],
        message: "A superseded command requires an applied successor command.",
      });
    if (value.action === "ACKNOWLEDGED_NO_ACTION" && hasSuccessor)
      context.addIssue({
        code: "custom",
        path: ["successorCommandId"],
        message: "An acknowledged command cannot name a successor.",
      });
  });
export type ResolveSyncCommandRequest = z.infer<
  typeof resolveSyncCommandRequestSchema
>;

export const syncRecoveryItemSchema = z.object({
  commandId: id,
  aggregateId: id,
  commandType: z.string().min(1).max(64),
  status: z.enum(["CONFLICT", "REJECTED"]),
  errorCode: z.string().nullable(),
  localSequence: z.string().regex(/^\d+$/),
  deviceCreatedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  resolution: z
    .object({
      id,
      action: syncResolutionActionSchema,
      successorCommandId: id.nullable(),
      reason: z.string(),
      resolvedById: id,
      resolvedAt: z.string().datetime(),
    })
    .nullable(),
});
export type SyncRecoveryItem = z.infer<typeof syncRecoveryItemSchema>;

export const syncRecoveryListResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  items: z.array(syncRecoveryItemSchema),
});
export type SyncRecoveryListResponse = z.infer<
  typeof syncRecoveryListResponseSchema
>;
