import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { ProcurementService } from "../src/procurement/procurement.service.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1),
  organizationId = id(2),
  userId = id(3),
  deviceId = id(4);
const principal = (permissions: readonly string[]): AuthPrincipal => ({
  userId,
  organizationId,
  deviceId,
  displayName: "Stock lead",
  email: "stock@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});
const transactionShell = () => ({
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
});
const prismaWithTransaction = (transaction: object) =>
  ({
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((work: (client: object) => unknown) =>
      work(transaction),
    ),
  }) as unknown as PrismaService;

describe("procurement service", () => {
  it("creates a branch supplier with audit and outbox evidence", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const supplier = {
      id: id(5),
      branchId,
      externalKey: "SUP-1",
      name: "Example supplier",
      contactName: null,
      phone: null,
      email: null,
      paymentTerms: null,
      leadTimeDays: null,
      isActive: true,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    const tx = {
      ...transactionShell(),
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      supplier: { create: vi.fn().mockResolvedValue(supplier) },
    };
    await expect(
      new ProcurementService(prismaWithTransaction(tx)).createSupplier(
        {
          supplierId: supplier.id,
          branchId,
          externalKey: "SUP-1",
          name: supplier.name,
          reason: "Approved supplier setup",
        },
        "procurement-supplier-key",
        principal(["procurement.configure"]),
      ),
    ).resolves.toMatchObject({ id: supplier.id });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "procurement.supplier.created",
      }),
    });
  });

  it("snapshots exact quantities and half-up line costs on a draft order", async () => {
    const supplierItem = {
      id: id(6),
      supplierId: id(5),
      inventoryItemId: id(7),
      purchaseUnitId: id(8),
      inventoryItem: {
        id: id(7),
        baseUnitId: id(8),
        name: "Ingredient",
        externalKey: "ING-1",
        baseUnit: { id: id(8) },
      },
      purchaseUnit: { id: id(8), code: "KG" },
    };
    const tx = {
      ...transactionShell(),
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId, currency: "GHS" }),
      },
      supplier: { findFirst: vi.fn().mockResolvedValue({ id: id(5) }) },
      supplierItem: { findMany: vi.fn().mockResolvedValue([supplierItem]) },
      purchaseOrder: {
        create: vi.fn().mockImplementation(({ data }) => {
          const now = new Date("2026-08-10T00:00:00.000Z");
          return Promise.resolve({
            ...data,
            status: "DRAFT",
            revision: 1,
            expectedAt: null,
            submittedAt: null,
            cancelledAt: null,
            createdAt: now,
            updatedAt: now,
            createdBy: { displayName: "Stock lead" },
            submittedBy: null,
            cancelledBy: null,
            supplier: {
              id: id(5),
              name: "Example supplier",
              externalKey: "SUP-1",
            },
            lines: data.lines.create,
            receipts: [],
          });
        }),
      },
    };
    const result = await new ProcurementService(
      prismaWithTransaction(tx),
    ).createOrder(
      {
        purchaseOrderId: id(9),
        branchId,
        supplierId: id(5),
        clientReference: "PO-LOCAL-1",
        reason: "Weekly replenishment",
        lines: [
          {
            purchaseOrderLineId: id(10),
            supplierItemId: id(6),
            orderedQuantityMicros: "1500000",
            unitCostMinor: 1001,
          },
        ],
      },
      "procurement-order-key",
      principal(["procurement.write"]),
    );
    expect(result).toMatchObject({ totalCostMinor: 1502, currency: "GHS" });
    expect(tx.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalCostMinor: 1502 }),
      }),
    );
  });

  it("blocks receiving more than the submitted order quantity", async () => {
    const tx = {
      branch: { findFirst: vi.fn() },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: id(9),
          branchId,
          supplierId: id(5),
          currency: "GHS",
          revision: 2,
          status: "SUBMITTED",
          lines: [
            {
              id: id(10),
              inventoryItemId: id(7),
              purchaseUnitId: id(8),
              orderedQuantityMicros: 1_000_000n,
              conversionNumerator: 1n,
              conversionDenominator: 1n,
              unitCostMinor: 500,
              receipts: [{ receivedQuantityMicros: 900_000n }],
            },
          ],
        }),
      },
      stockLocation: { count: vi.fn().mockResolvedValue(1) },
    };
    const prisma = prismaWithTransaction(tx);
    await expect(
      new ProcurementService(prisma).postReceipt(
        id(9),
        {
          goodsReceiptId: id(11),
          branchId,
          purchaseOrderRevision: 2,
          receivedAt: "2026-08-07T10:00:00.000Z",
          reason: "Delivery received",
          lines: [
            {
              goodsReceiptLineId: id(12),
              purchaseOrderLineId: id(10),
              stockLedgerEntryId: id(13),
              locationId: id(14),
              receivedQuantityMicros: "200000",
            },
          ],
        },
        "procurement-over-receipt",
        principal(["procurement.write"]),
      ),
    ).rejects.toMatchObject({
      response: { code: "PURCHASE_ORDER_OVER_RECEIPT" },
    });
  });

  it("labels valuation output as provisional", async () => {
    const prisma = {
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId, currency: "GHS" }),
      },
      stockLedgerEntry: { groupBy: vi.fn().mockResolvedValue([]) },
      goodsReceiptLine: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    await expect(
      new ProcurementService(prisma).valuationPreview(
        branchId,
        {},
        principal(["procurement.read"]),
      ),
    ).resolves.toMatchObject({
      officialValuationAvailable: false,
      configurationIssue: "INVENTORY_COST_METHOD_UNCONFIRMED",
    });
  });

  it("enforces branch permission before procurement reads", async () => {
    await expect(
      new ProcurementService({} as PrismaService).listOrders(
        branchId,
        { limit: 10, includeInactive: false },
        principal([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
