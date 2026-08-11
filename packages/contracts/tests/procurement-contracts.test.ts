import { describe, expect, it } from "vitest";
import {
  createPurchaseOrderSchema,
  goodsReceiptResponseSchema,
  postGoodsReceiptSchema,
  postPurchaseReturnSchema,
  procurementValuationResponseSchema,
  purchaseOrderResponseSchema,
  purchaseReturnResponseSchema,
  supplierResponseSchema,
} from "../src/procurement.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("procurement contracts", () => {
  it("rejects duplicate supplier items on one purchase order", () => {
    const result = createPurchaseOrderSchema.safeParse({
      purchaseOrderId: id(1),
      branchId: id(2),
      supplierId: id(3),
      clientReference: "PO-OFFLINE-1",
      reason: "Restock request",
      lines: [
        {
          purchaseOrderLineId: id(4),
          supplierItemId: id(5),
          orderedQuantityMicros: "1000000",
          unitCostMinor: 500,
        },
        {
          purchaseOrderLineId: id(6),
          supplierItemId: id(5),
          orderedQuantityMicros: "2000000",
          unitCostMinor: 500,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires exact positive integer-micro receipt quantities", () => {
    const result = postGoodsReceiptSchema.safeParse({
      goodsReceiptId: id(1),
      branchId: id(2),
      purchaseOrderRevision: 2,
      receivedAt: "2026-08-07T10:00:00.000Z",
      reason: "Goods inspected",
      lines: [
        {
          goodsReceiptLineId: id(3),
          purchaseOrderLineId: id(4),
          stockLedgerEntryId: id(5),
          locationId: id(6),
          receivedQuantityMicros: "1.5",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate receipt lines on a return", () => {
    const result = postPurchaseReturnSchema.safeParse({
      purchaseReturnId: id(1),
      branchId: id(2),
      returnedAt: "2026-08-07T11:00:00.000Z",
      reason: "Damaged delivery return",
      allowNegativeOverride: false,
      lines: [
        {
          purchaseReturnLineId: id(3),
          goodsReceiptLineId: id(4),
          stockLedgerEntryId: id(5),
          returnedQuantityMicros: "100000",
        },
        {
          purchaseReturnLineId: id(6),
          goodsReceiptLineId: id(4),
          stockLedgerEntryId: id(7),
          returnedQuantityMicros: "100000",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("validates stable actor-minimized procurement projections", () => {
    const now = "2026-08-10T00:00:00.000Z";
    const supplier = supplierResponseSchema.parse({
      id: id(1),
      branchId: id(2),
      externalKey: "FICTIONAL_SUPPLIER",
      name: "Fictional supplier",
      contactName: null,
      phone: null,
      email: null,
      paymentTerms: "Fictional seven days",
      leadTimeDays: 2,
      isActive: true,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      items: [],
    });
    const receipt = goodsReceiptResponseSchema.parse({
      id: id(10),
      branchId: id(2),
      purchaseOrderId: id(3),
      supplierId: supplier.id,
      currency: "GHS",
      totalCostMinor: 500,
      supplierDocumentReference: "FICTIONAL-GRN-1",
      receivedAt: now,
      reason: "Receive fictional goods",
      createdAt: now,
      postedByDisplayName: "Stock lead",
      supplier: { id: supplier.id, name: supplier.name },
      lines: [
        {
          id: id(11),
          purchaseOrderLineId: id(4),
          locationId: id(12),
          inventoryItemId: id(5),
          purchaseUnitId: id(6),
          receivedQuantityMicros: "1000000",
          receivedBaseMicros: "1000000",
          unitCostMinor: 500,
          lineCostMinor: 500,
          lotReference: null,
          expiresOn: null,
        },
      ],
    });
    const order = purchaseOrderResponseSchema.parse({
      id: id(3),
      branchId: id(2),
      supplierId: supplier.id,
      clientReference: "FICTIONAL-PO-1",
      status: "COMPLETED",
      revision: 3,
      currency: "GHS",
      totalCostMinor: 500,
      expectedAt: null,
      reason: "Order fictional goods",
      submittedAt: now,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      createdByDisplayName: "Stock lead",
      submittedByDisplayName: "Stock lead",
      cancelledByDisplayName: null,
      supplier: {
        id: supplier.id,
        name: supplier.name,
        externalKey: supplier.externalKey,
      },
      lines: [
        {
          id: id(4),
          supplierItemId: id(7),
          inventoryItemId: id(5),
          purchaseUnitId: id(6),
          inventoryItemName: "Fictional cocoa",
          inventoryItemExternalKey: "FICTIONAL_COCOA",
          purchaseUnitCode: "EA",
          orderedQuantityMicros: "1000000",
          conversionNumerator: "1",
          conversionDenominator: "1",
          unitCostMinor: 500,
          lineCostMinor: 500,
        },
      ],
      receipts: [receipt],
    });
    const returned = purchaseReturnResponseSchema.parse({
      id: id(20),
      branchId: id(2),
      goodsReceiptId: receipt.id,
      supplierId: supplier.id,
      currency: "GHS",
      totalCostMinor: 125,
      supplierDocumentReference: null,
      returnedAt: now,
      reason: "Return fictional goods",
      negativeStockOverride: false,
      createdAt: now,
      postedByDisplayName: "Stock lead",
      supplier: { id: supplier.id, name: supplier.name },
      lines: [
        {
          id: id(21),
          goodsReceiptLineId: receipt.lines[0]!.id,
          locationId: receipt.lines[0]!.locationId,
          inventoryItemId: receipt.lines[0]!.inventoryItemId,
          returnedQuantityMicros: "250000",
          returnedBaseMicros: "250000",
          unitCostMinor: 500,
          lineCostMinor: 125,
        },
      ],
    });
    const valuation = procurementValuationResponseSchema.parse({
      generatedAt: now,
      branchId: id(2),
      currency: "GHS",
      officialValuationAvailable: false,
      configurationIssue: "INVENTORY_COST_METHOD_UNCONFIRMED",
      basis: "PROVISIONAL_NET_RECEIPT_COST",
      rows: [],
    });
    expect(order.receipts[0]?.lines[0]?.receivedBaseMicros).toBe("1000000");
    expect(returned.lines[0]?.returnedBaseMicros).toBe("250000");
    expect(valuation.officialValuationAvailable).toBe(false);
    expect(order).not.toHaveProperty("createdById");
    expect(receipt).not.toHaveProperty("deviceId");
  });
});
