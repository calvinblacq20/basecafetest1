import { describe, expect, it } from "vitest";

import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  mergeOrdersRequestSchema,
  moveOrderTableRequestSchema,
  orderListResponseSchema,
  orderListQuerySchema,
  orderOperationDetailResponseSchema,
  orderOperationOptionsResponseSchema,
  splitOrderRequestSchema,
  transferOrderResponsibilityRequestSchema,
} from "../src/index.js";

const ids = {
  orderId: "10000000-0000-4000-8000-000000000001",
  branchId: "10000000-0000-4000-8000-000000000002",
  shiftId: "10000000-0000-4000-8000-000000000003",
};

describe("order contracts", () => {
  it.each([
    ["DINE_IN", {}],
    ["TAKEAWAY", { pickupReference: "PA-4" }],
    ["PHONE_DELIVERY", { customerReference: "Caller 7" }],
    ["BAR_TAB", { tabName: "Kwame" }],
  ] as const)("accepts %s channel facts", (channel, fields) => {
    expect(
      createOrderRequestSchema.parse({
        ...ids,
        clientReference: `offline-${channel}`,
        channel,
        reason: "Cashier opened order",
        ...fields,
      }).channel,
    ).toBe(channel);
  });

  it("allows quick dine-in without a table", () => {
    const value = createOrderRequestSchema.parse({
      ...ids,
      clientReference: "quick-1",
      channel: "DINE_IN",
      reason: "Counter order",
    });
    expect(value.tableId).toBeUndefined();
  });

  it("rejects missing delivery reference and invalid channel fields", () => {
    expect(
      createOrderRequestSchema.safeParse({
        ...ids,
        clientReference: "delivery-1",
        channel: "PHONE_DELIVERY",
        reason: "Phone order",
      }).success,
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...ids,
        clientReference: "takeaway-1",
        channel: "TAKEAWAY",
        tableId: "10000000-0000-4000-8000-000000000004",
        reason: "Invalid table",
      }).success,
    ).toBe(false);
  });

  it("requires client line IDs and positive quantities", () => {
    expect(
      addOrderLineRequestSchema.safeParse({
        branchId: ids.branchId,
        orderRevision: 1,
        lineId: "10000000-0000-4000-8000-000000000005",
        menuItemId: "10000000-0000-4000-8000-000000000006",
        quantity: 0,
        reason: "Add item",
      }).success,
    ).toBe(false);
  });

  it("bounds list queries", () => {
    expect(orderListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(orderListQuerySchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
  });

  it("parses PII-minimized order workspace responses", () => {
    const summary = {
      id: ids.orderId,
      orderNumber: "20260809-0001",
      clientReference: "POS-TEST-1",
      channel: "DINE_IN",
      status: "OPEN",
      revision: 2,
      businessDate: "2026-08-09",
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:01:00.000Z",
      table: { id: ids.shiftId, name: "Fictional Table 1" },
      assignedServer: { id: ids.branchId, displayName: "Demo Cashier" },
      guestCount: 2,
      pickupReference: null,
      customerReference: null,
      tabName: null,
      activeLineCount: 1,
      grossTotalMinor: 2400,
    } as const;
    expect(orderListResponseSchema.parse([summary])).toHaveLength(1);
    expect(
      orderOperationOptionsResponseSchema.parse({
        staff: [{ id: ids.branchId, displayName: "Demo Cashier" }],
      }).staff,
    ).toHaveLength(1);
    expect(
      orderOperationDetailResponseSchema.parse({
        ...summary,
        businessDate: "2026-08-09T00:00:00.000Z",
        lines: [
          {
            id: ids.shiftId,
            status: "DRAFT",
            itemNameSnapshot: "Fictional Item",
            variantNameSnapshot: null,
            quantity: 2,
            grossAmountMinor: 2400,
            sentAt: null,
          },
        ],
      }).lines[0]?.itemNameSnapshot,
    ).toBe("Fictional Item");
  });

  it("accepts client-addressable move, transfer, and merge commands", () => {
    expect(
      moveOrderTableRequestSchema.parse({
        operationId: ids.orderId,
        branchId: ids.branchId,
        revision: 2,
        tableId: null,
        reason: "Detach table",
      }).tableId,
    ).toBeNull();
    expect(
      transferOrderResponsibilityRequestSchema.parse({
        operationId: ids.orderId,
        branchId: ids.branchId,
        revision: 2,
        receivingUserId: ids.shiftId,
        reason: "Server handover",
      }).receivingUserId,
    ).toBe(ids.shiftId);
    expect(
      mergeOrdersRequestSchema.parse({
        mergeId: ids.orderId,
        branchId: ids.branchId,
        targetRevision: 2,
        sourceOrderId: ids.shiftId,
        sourceRevision: 3,
        reason: "Merge tabs",
      }).sourceRevision,
    ).toBe(3);
  });

  it("accepts quantity split lineage and rejects duplicate result IDs", () => {
    const base = {
      splitId: ids.orderId,
      branchId: ids.branchId,
      sourceRevision: 4,
      newOrderId: ids.shiftId,
      newClientReference: "split-child-1",
      reason: "Split two guests",
    };
    expect(
      splitOrderRequestSchema.parse({
        ...base,
        lines: [
          {
            sourceLineId: "10000000-0000-4000-8000-000000000010",
            targetLineId: "10000000-0000-4000-8000-000000000011",
            remainderLineId: "10000000-0000-4000-8000-000000000012",
            quantity: 1,
          },
        ],
      }).lines,
    ).toHaveLength(1);
    expect(
      splitOrderRequestSchema.safeParse({
        ...base,
        lines: [
          {
            sourceLineId: "10000000-0000-4000-8000-000000000010",
            targetLineId: "10000000-0000-4000-8000-000000000011",
            quantity: 1,
          },
          {
            sourceLineId: "10000000-0000-4000-8000-000000000013",
            targetLineId: "10000000-0000-4000-8000-000000000011",
            quantity: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
