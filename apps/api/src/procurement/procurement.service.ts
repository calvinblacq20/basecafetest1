import type {
  CreatePurchaseOrder,
  CreateSupplier,
  CreateSupplierItem,
  PostGoodsReceipt,
  PostPurchaseReturn,
  ProcurementListQuery,
  ProcurementValuationQuery,
  TransitionPurchaseOrder,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PurchaseOrderStatus, StockLedgerType } from "@prisma/client";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;
type Result = {
  entityId: string;
  eventType: string;
  reason: string;
  response: unknown;
};
const oneUnitMicros = 1_000_000n;
const intMaximum = 2_147_483_647n;

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        jsonSafe(nested),
      ]),
    );
  return value;
};
const asJson = (value: unknown) => jsonSafe(value) as Prisma.InputJsonObject;
const halfUp = (numerator: bigint, denominator: bigint) =>
  numerator / denominator +
  ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
const checkedMinor = (value: bigint) => {
  if (value < 0n || value > intMaximum) {
    throw new ConflictException({ code: "PROCUREMENT_TOTAL_OVERFLOW" });
  }
  return Number(value);
};

const supplierItemSelect = {
  id: true,
  branchId: true,
  supplierId: true,
  inventoryItemId: true,
  purchaseUnitId: true,
  supplierSku: true,
  isActive: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  inventoryItem: {
    select: { id: true, externalKey: true, name: true, baseUnitId: true },
  },
  purchaseUnit: {
    select: { id: true, code: true, name: true, dimension: true },
  },
} satisfies Prisma.SupplierItemSelect;
const supplierSelect = {
  id: true,
  branchId: true,
  externalKey: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  paymentTerms: true,
  leadTimeDays: true,
  isActive: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  items: { select: supplierItemSelect, orderBy: { id: "asc" as const } },
} satisfies Prisma.SupplierSelect;
const orderLineSelect = {
  id: true,
  supplierItemId: true,
  inventoryItemId: true,
  purchaseUnitId: true,
  inventoryItemName: true,
  inventoryItemExternalKey: true,
  purchaseUnitCode: true,
  orderedQuantityMicros: true,
  conversionNumerator: true,
  conversionDenominator: true,
  unitCostMinor: true,
  lineCostMinor: true,
} satisfies Prisma.PurchaseOrderLineSelect;
const receiptLineSelect = {
  id: true,
  purchaseOrderLineId: true,
  locationId: true,
  inventoryItemId: true,
  purchaseUnitId: true,
  receivedQuantityMicros: true,
  receivedBaseMicros: true,
  unitCostMinor: true,
  lineCostMinor: true,
  lotReference: true,
  expiresOn: true,
} satisfies Prisma.GoodsReceiptLineSelect;
const receiptSelect = {
  id: true,
  branchId: true,
  purchaseOrderId: true,
  supplierId: true,
  currency: true,
  totalCostMinor: true,
  supplierDocumentReference: true,
  receivedAt: true,
  reason: true,
  createdAt: true,
  postedBy: { select: { displayName: true } },
  supplier: { select: { id: true, name: true } },
  lines: { select: receiptLineSelect, orderBy: { id: "asc" as const } },
} satisfies Prisma.GoodsReceiptSelect;
const orderSelect = {
  id: true,
  branchId: true,
  supplierId: true,
  clientReference: true,
  status: true,
  revision: true,
  currency: true,
  totalCostMinor: true,
  expectedAt: true,
  reason: true,
  submittedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  submittedBy: { select: { displayName: true } },
  cancelledBy: { select: { displayName: true } },
  supplier: { select: { id: true, name: true, externalKey: true } },
  lines: { select: orderLineSelect, orderBy: { id: "asc" as const } },
  receipts: {
    select: receiptSelect,
    orderBy: [{ receivedAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.PurchaseOrderSelect;
const returnLineSelect = {
  id: true,
  goodsReceiptLineId: true,
  locationId: true,
  inventoryItemId: true,
  returnedQuantityMicros: true,
  returnedBaseMicros: true,
  unitCostMinor: true,
  lineCostMinor: true,
} satisfies Prisma.PurchaseReturnLineSelect;
const returnSelect = {
  id: true,
  branchId: true,
  goodsReceiptId: true,
  supplierId: true,
  currency: true,
  totalCostMinor: true,
  supplierDocumentReference: true,
  returnedAt: true,
  reason: true,
  negativeStockOverride: true,
  createdAt: true,
  postedBy: { select: { displayName: true } },
  supplier: { select: { id: true, name: true } },
  lines: { select: returnLineSelect, orderBy: { id: "asc" as const } },
} satisfies Prisma.PurchaseReturnSelect;

type SupplierRow = Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>;
type SupplierItemRow = Prisma.SupplierItemGetPayload<{
  select: typeof supplierItemSelect;
}>;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ select: typeof orderSelect }>;
type ReceiptRow = Prisma.GoodsReceiptGetPayload<{
  select: typeof receiptSelect;
}>;
type ReturnRow = Prisma.PurchaseReturnGetPayload<{
  select: typeof returnSelect;
}>;
const iso = (value: Date) => value.toISOString();
const dateOnly = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;
const publicSupplierItem = (row: SupplierItemRow) => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});
const publicSupplier = (row: SupplierRow) => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  items: row.items.map(publicSupplierItem),
});
const publicReceipt = (row: ReceiptRow) => {
  const { postedBy, ...record } = row;
  return {
    ...record,
    postedByDisplayName: postedBy.displayName,
    receivedAt: iso(row.receivedAt),
    createdAt: iso(row.createdAt),
    lines: row.lines.map((line) => ({
      ...line,
      receivedQuantityMicros: line.receivedQuantityMicros.toString(),
      receivedBaseMicros: line.receivedBaseMicros.toString(),
      expiresOn: dateOnly(line.expiresOn),
    })),
  };
};
const publicOrder = (row: OrderRow) => {
  const { createdBy, submittedBy, cancelledBy, ...record } = row;
  return {
    ...record,
    createdByDisplayName: createdBy.displayName,
    submittedByDisplayName: submittedBy?.displayName ?? null,
    cancelledByDisplayName: cancelledBy?.displayName ?? null,
    expectedAt: row.expectedAt ? iso(row.expectedAt) : null,
    submittedAt: row.submittedAt ? iso(row.submittedAt) : null,
    cancelledAt: row.cancelledAt ? iso(row.cancelledAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lines: row.lines.map((line) => ({
      ...line,
      orderedQuantityMicros: line.orderedQuantityMicros.toString(),
      conversionNumerator: line.conversionNumerator.toString(),
      conversionDenominator: line.conversionDenominator.toString(),
    })),
    receipts: row.receipts.map(publicReceipt),
  };
};
const publicReturn = (row: ReturnRow) => {
  const { postedBy, ...record } = row;
  return {
    ...record,
    postedByDisplayName: postedBy.displayName,
    returnedAt: iso(row.returnedAt),
    createdAt: iso(row.createdAt),
    lines: row.lines.map((line) => ({
      ...line,
      returnedQuantityMicros: line.returnedQuantityMicros.toString(),
      returnedBaseMicros: line.returnedBaseMicros.toString(),
    })),
  };
};

@Injectable()
export class ProcurementService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listSuppliers(
    branchId: string,
    query: ProcurementListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.supplier.findMany({
      where: { branchId, ...(query.includeInactive ? {} : { isActive: true }) },
      select: supplierSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
    });
    return rows.map(publicSupplier);
  }

  async listOrders(
    branchId: string,
    query: ProcurementListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        branchId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      select: orderSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
    });
    return rows.map(publicOrder);
  }

  async listReceipts(
    branchId: string,
    query: ProcurementListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.goodsReceipt.findMany({
      where: {
        branchId,
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      select: receiptSelect,
      orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
    });
    return rows.map(publicReceipt);
  }

  async listReturns(
    branchId: string,
    query: ProcurementListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.purchaseReturn.findMany({
      where: {
        branchId,
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      select: returnSelect,
      orderBy: [{ returnedAt: "desc" }, { id: "asc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
    });
    return rows.map(publicReturn);
  }

  createSupplier(input: CreateSupplier, key: string, principal: AuthPrincipal) {
    this.permission(principal, "procurement.configure", input.branchId);
    return this.idempotent(
      "procurement.supplier.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const supplier = await tx.supplier.create({
          data: {
            id: input.supplierId,
            branchId: input.branchId,
            externalKey: input.externalKey,
            name: input.name,
            contactName: input.contactName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            paymentTerms: input.paymentTerms ?? null,
            leadTimeDays: input.leadTimeDays ?? null,
          },
          select: supplierSelect,
        });
        return this.result(
          supplier.id,
          "procurement.supplier.created",
          input.reason,
          publicSupplier(supplier),
        );
      },
    );
  }

  createSupplierItem(
    input: CreateSupplierItem,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.configure", input.branchId);
    return this.idempotent(
      "procurement.supplier-item.create",
      key,
      input,
      principal,
      async (tx) => {
        const branch = await this.branch(input.branchId, principal, tx);
        const [supplier, item, unit] = await Promise.all([
          tx.supplier.findFirst({
            where: {
              id: input.supplierId,
              branchId: input.branchId,
              isActive: true,
            },
          }),
          tx.inventoryItem.findFirst({
            where: {
              id: input.inventoryItemId,
              branchId: input.branchId,
              isActive: true,
            },
            include: { baseUnit: true },
          }),
          tx.inventoryUnit.findFirst({
            where: {
              id: input.purchaseUnitId,
              organizationId: branch.organizationId,
              isActive: true,
            },
          }),
        ]);
        if (!supplier)
          throw new ConflictException({ code: "SUPPLIER_UNAVAILABLE" });
        if (!item || !unit)
          throw new ConflictException({
            code: "INVENTORY_ITEM_OR_UNIT_UNAVAILABLE",
          });
        if (item.baseUnit.dimension !== unit.dimension) {
          throw new ConflictException({ code: "INVENTORY_DIMENSION_MISMATCH" });
        }
        if (item.baseUnitId !== unit.id)
          await this.conversion(
            tx,
            branch.organizationId,
            unit.id,
            item.baseUnitId,
          );
        const supplierItem = await tx.supplierItem.create({
          data: {
            id: input.supplierItemId,
            branchId: input.branchId,
            supplierId: input.supplierId,
            inventoryItemId: input.inventoryItemId,
            purchaseUnitId: input.purchaseUnitId,
            supplierSku: input.supplierSku ?? null,
          },
          select: supplierItemSelect,
        });
        return this.result(
          supplierItem.id,
          "procurement.supplier-item.created",
          input.reason,
          publicSupplierItem(supplierItem),
        );
      },
    );
  }

  createOrder(
    input: CreatePurchaseOrder,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.write", input.branchId);
    return this.idempotent(
      "procurement.purchase-order.create",
      key,
      input,
      principal,
      async (tx) => {
        const branch = await this.branch(input.branchId, principal, tx, true);
        const supplier = await tx.supplier.findFirst({
          where: {
            id: input.supplierId,
            branchId: input.branchId,
            isActive: true,
          },
        });
        if (!supplier)
          throw new ConflictException({ code: "SUPPLIER_UNAVAILABLE" });
        const supplierItems = await tx.supplierItem.findMany({
          where: {
            id: { in: input.lines.map((line) => line.supplierItemId) },
            supplierId: input.supplierId,
            branchId: input.branchId,
            isActive: true,
          },
          include: {
            inventoryItem: { include: { baseUnit: true } },
            purchaseUnit: true,
          },
        });
        if (supplierItems.length !== input.lines.length) {
          throw new ConflictException({ code: "SUPPLIER_ITEM_UNAVAILABLE" });
        }
        let total = 0n;
        const lines = [];
        for (const command of input.lines) {
          const configured = supplierItems.find(
            (item) => item.id === command.supplierItemId,
          )!;
          const ratio =
            configured.purchaseUnitId === configured.inventoryItem.baseUnitId
              ? { numerator: 1n, denominator: 1n }
              : await this.conversion(
                  tx,
                  branch.organizationId,
                  configured.purchaseUnitId,
                  configured.inventoryItem.baseUnitId,
                );
          const quantity = BigInt(command.orderedQuantityMicros);
          const lineCost = halfUp(
            quantity * BigInt(command.unitCostMinor),
            oneUnitMicros,
          );
          total += lineCost;
          lines.push({
            id: command.purchaseOrderLineId,
            supplierItemId: configured.id,
            inventoryItemId: configured.inventoryItemId,
            purchaseUnitId: configured.purchaseUnitId,
            inventoryItemName: configured.inventoryItem.name,
            inventoryItemExternalKey: configured.inventoryItem.externalKey,
            purchaseUnitCode: configured.purchaseUnit.code,
            orderedQuantityMicros: quantity,
            conversionNumerator: ratio.numerator,
            conversionDenominator: ratio.denominator,
            unitCostMinor: command.unitCostMinor,
            lineCostMinor: checkedMinor(lineCost),
          });
        }
        const order = await tx.purchaseOrder.create({
          data: {
            id: input.purchaseOrderId,
            branchId: input.branchId,
            supplierId: input.supplierId,
            createdById: principal.userId,
            clientReference: input.clientReference,
            currency: branch.currency,
            totalCostMinor: checkedMinor(total),
            expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
            reason: input.reason,
            lines: { create: lines },
          },
          select: orderSelect,
        });
        return this.result(
          order.id,
          "procurement.purchase-order.created",
          input.reason,
          publicOrder(order),
        );
      },
    );
  }

  transitionOrder(
    orderId: string,
    action: "submit" | "cancel",
    input: TransitionPurchaseOrder,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(
      principal,
      action === "cancel" ? "procurement.manage" : "procurement.write",
      input.branchId,
    );
    return this.idempotent(
      `procurement.purchase-order.${action}`,
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (!order) throw new NotFoundException("Purchase order not found.");
        if (order.revision !== input.revision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (action === "submit" && order.status !== PurchaseOrderStatus.DRAFT) {
          throw new ConflictException({
            code: "PURCHASE_ORDER_SUBMISSION_INVALID",
          });
        }
        if (
          action === "cancel" &&
          order.status !== PurchaseOrderStatus.DRAFT &&
          order.status !== PurchaseOrderStatus.SUBMITTED
        ) {
          throw new ConflictException({
            code: "PURCHASE_ORDER_CANCELLATION_INVALID",
          });
        }
        const now = new Date();
        const updated = await tx.purchaseOrder.update({
          where: { id: order.id },
          data:
            action === "submit"
              ? {
                  status: PurchaseOrderStatus.SUBMITTED,
                  revision: { increment: 1 },
                  submittedById: principal.userId,
                  submittedAt: now,
                }
              : {
                  status: PurchaseOrderStatus.CANCELLED,
                  revision: { increment: 1 },
                  cancelledById: principal.userId,
                  cancelledAt: now,
                },
          select: orderSelect,
        });
        return this.result(
          updated.id,
          `procurement.purchase-order.${action === "submit" ? "submitted" : "cancelled"}`,
          input.reason,
          publicOrder(updated),
        );
      },
    );
  }

  postReceipt(
    orderId: string,
    input: PostGoodsReceipt,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.write", input.branchId);
    return this.idempotent(
      "procurement.goods-receipt.post",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: { lines: { include: { receipts: true } } },
        });
        if (!order) throw new NotFoundException("Purchase order not found.");
        if (order.revision !== input.purchaseOrderRevision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (
          order.status !== PurchaseOrderStatus.SUBMITTED &&
          order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
        ) {
          throw new ConflictException({
            code: "PURCHASE_ORDER_RECEIPT_INVALID",
          });
        }
        const locations = await tx.stockLocation.count({
          where: {
            branchId: input.branchId,
            isActive: true,
            id: { in: input.lines.map((line) => line.locationId) },
          },
        });
        if (
          locations !== new Set(input.lines.map((line) => line.locationId)).size
        ) {
          throw new ConflictException({ code: "STOCK_LOCATION_UNAVAILABLE" });
        }
        let total = 0n;
        const receivedByLine = new Map<string, bigint>();
        const lineCreates = [];
        const ledgerCreates = [];
        for (const command of input.lines) {
          const line = order.lines.find(
            (candidate) => candidate.id === command.purchaseOrderLineId,
          );
          if (!line)
            throw new ConflictException({
              code: "PURCHASE_ORDER_LINE_INVALID",
            });
          const prior = line.receipts.reduce(
            (sum, receipt) => sum + receipt.receivedQuantityMicros,
            0n,
          );
          const quantity = BigInt(command.receivedQuantityMicros);
          if (prior + quantity > line.orderedQuantityMicros) {
            throw new ConflictException({
              code: "PURCHASE_ORDER_OVER_RECEIPT",
            });
          }
          const baseNumerator = quantity * line.conversionNumerator;
          if (baseNumerator % line.conversionDenominator !== 0n) {
            throw new ConflictException({
              code: "PURCHASE_UNIT_CONVERSION_INEXACT",
            });
          }
          const baseQuantity = baseNumerator / line.conversionDenominator;
          const lineCost = halfUp(
            quantity * BigInt(line.unitCostMinor),
            oneUnitMicros,
          );
          total += lineCost;
          receivedByLine.set(line.id, prior + quantity);
          lineCreates.push({
            id: command.goodsReceiptLineId,
            purchaseOrderLineId: line.id,
            locationId: command.locationId,
            inventoryItemId: line.inventoryItemId,
            purchaseUnitId: line.purchaseUnitId,
            receivedQuantityMicros: quantity,
            receivedBaseMicros: baseQuantity,
            unitCostMinor: line.unitCostMinor,
            lineCostMinor: checkedMinor(lineCost),
            lotReference: command.lotReference ?? null,
            expiresOn: command.expiresOn
              ? new Date(`${command.expiresOn}T00:00:00.000Z`)
              : null,
          });
          ledgerCreates.push({
            id: command.stockLedgerEntryId,
            branchId: input.branchId,
            locationId: command.locationId,
            inventoryItemId: line.inventoryItemId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: StockLedgerType.PURCHASE_RECEIPT,
            quantityDeltaMicros: baseQuantity,
            sourceType: "GOODS_RECEIPT",
            sourceId: input.goodsReceiptId,
            reason: input.reason,
            occurredAt: new Date(input.receivedAt),
          });
        }
        const receipt = await tx.goodsReceipt.create({
          data: {
            id: input.goodsReceiptId,
            branchId: input.branchId,
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            postedById: principal.userId,
            deviceId: principal.deviceId,
            currency: order.currency,
            totalCostMinor: checkedMinor(total),
            supplierDocumentReference: input.supplierDocumentReference ?? null,
            receivedAt: new Date(input.receivedAt),
            reason: input.reason,
            lines: { create: lineCreates },
          },
          select: receiptSelect,
        });
        await tx.stockLedgerEntry.createMany({ data: ledgerCreates });
        const completed = order.lines.every(
          (line) =>
            (receivedByLine.get(line.id) ??
              line.receipts.reduce(
                (sum, receiptLine) => sum + receiptLine.receivedQuantityMicros,
                0n,
              )) >= line.orderedQuantityMicros,
        );
        const updatedOrder = await tx.purchaseOrder.update({
          where: { id: order.id },
          data: {
            status: completed
              ? PurchaseOrderStatus.COMPLETED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
            revision: { increment: 1 },
          },
          select: orderSelect,
        });
        return this.result(
          receipt.id,
          "procurement.goods-receipt.posted",
          input.reason,
          {
            receipt: publicReceipt(receipt),
            purchaseOrder: publicOrder(updatedOrder),
          },
        );
      },
    );
  }

  postReturn(
    receiptId: string,
    input: PostPurchaseReturn,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.write", input.branchId);
    return this.idempotent(
      "procurement.purchase-return.post",
      key,
      { receiptId, ...input },
      principal,
      async (tx) => {
        const receipt = await tx.goodsReceipt.findFirst({
          where: {
            id: receiptId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: {
            lines: { include: { purchaseOrderLine: true, returnLines: true } },
          },
        });
        if (!receipt) throw new NotFoundException("Goods receipt not found.");
        let total = 0n;
        const returnLines = [];
        const ledgerLines = [];
        for (const command of input.lines) {
          const line = receipt.lines.find(
            (candidate) => candidate.id === command.goodsReceiptLineId,
          );
          if (!line)
            throw new ConflictException({ code: "GOODS_RECEIPT_LINE_INVALID" });
          const prior = line.returnLines.reduce(
            (sum, returned) => sum + returned.returnedQuantityMicros,
            0n,
          );
          const quantity = BigInt(command.returnedQuantityMicros);
          if (prior + quantity > line.receivedQuantityMicros) {
            throw new ConflictException({
              code: "PURCHASE_RETURN_EXCEEDS_RECEIPT",
            });
          }
          const numerator =
            quantity * line.purchaseOrderLine.conversionNumerator;
          if (numerator % line.purchaseOrderLine.conversionDenominator !== 0n) {
            throw new ConflictException({
              code: "PURCHASE_UNIT_CONVERSION_INEXACT",
            });
          }
          const baseQuantity =
            numerator / line.purchaseOrderLine.conversionDenominator;
          await this.assertNonNegative(
            tx,
            input.branchId,
            line.locationId,
            line.inventoryItemId,
            -baseQuantity,
            input.allowNegativeOverride,
            principal,
          );
          const cost = halfUp(
            quantity * BigInt(line.unitCostMinor),
            oneUnitMicros,
          );
          total += cost;
          returnLines.push({
            id: command.purchaseReturnLineId,
            goodsReceiptLineId: line.id,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            returnedQuantityMicros: quantity,
            returnedBaseMicros: baseQuantity,
            unitCostMinor: line.unitCostMinor,
            lineCostMinor: checkedMinor(cost),
          });
          ledgerLines.push({
            id: command.stockLedgerEntryId,
            branchId: input.branchId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: StockLedgerType.PURCHASE_RETURN,
            quantityDeltaMicros: -baseQuantity,
            sourceType: "PURCHASE_RETURN",
            sourceId: input.purchaseReturnId,
            negativeStockOverride: input.allowNegativeOverride,
            reason: input.reason,
            occurredAt: new Date(input.returnedAt),
          });
        }
        const returned = await tx.purchaseReturn.create({
          data: {
            id: input.purchaseReturnId,
            branchId: input.branchId,
            goodsReceiptId: receipt.id,
            supplierId: receipt.supplierId,
            postedById: principal.userId,
            deviceId: principal.deviceId,
            currency: receipt.currency,
            totalCostMinor: checkedMinor(total),
            supplierDocumentReference: input.supplierDocumentReference ?? null,
            returnedAt: new Date(input.returnedAt),
            reason: input.reason,
            negativeStockOverride: input.allowNegativeOverride,
            lines: { create: returnLines },
          },
          select: returnSelect,
        });
        await tx.stockLedgerEntry.createMany({ data: ledgerLines });
        return this.result(
          returned.id,
          "procurement.purchase-return.posted",
          input.reason,
          publicReturn(returned),
        );
      },
    );
  }

  async valuationPreview(
    branchId: string,
    query: ProcurementValuationQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "procurement.read", branchId);
    const branch = await this.branch(branchId, principal, this.prisma, true);
    const balances = await this.prisma.stockLedgerEntry.groupBy({
      by: ["locationId", "inventoryItemId"],
      where: {
        branchId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.inventoryItemId
          ? { inventoryItemId: query.inventoryItemId }
          : {}),
      },
      _sum: { quantityDeltaMicros: true },
      orderBy: [{ inventoryItemId: "asc" }, { locationId: "asc" }],
    });
    const receiptLines = await this.prisma.goodsReceiptLine.findMany({
      where: {
        goodsReceipt: { branchId },
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.inventoryItemId
          ? { inventoryItemId: query.inventoryItemId }
          : {}),
      },
      include: { returnLines: true },
      orderBy: [{ goodsReceipt: { receivedAt: "asc" } }, { id: "asc" }],
    });
    const costs = new Map<
      string,
      { base: bigint; minor: bigint; lastUnitCostMinor: number | null }
    >();
    for (const line of receiptLines) {
      const returnedBase = line.returnLines.reduce(
        (sum, returned) => sum + returned.returnedBaseMicros,
        0n,
      );
      const returnedCost = line.returnLines.reduce(
        (sum, returned) => sum + BigInt(returned.lineCostMinor),
        0n,
      );
      const costKey = `${line.locationId}:${line.inventoryItemId}`;
      const current = costs.get(costKey) ?? {
        base: 0n,
        minor: 0n,
        lastUnitCostMinor: null,
      };
      current.base += line.receivedBaseMicros - returnedBase;
      current.minor += BigInt(line.lineCostMinor) - returnedCost;
      current.lastUnitCostMinor = line.unitCostMinor;
      costs.set(costKey, current);
    }
    return {
      generatedAt: new Date().toISOString(),
      branchId,
      currency: branch.currency,
      officialValuationAvailable: false,
      configurationIssue: "INVENTORY_COST_METHOD_UNCONFIRMED",
      basis: "PROVISIONAL_NET_RECEIPT_COST",
      rows: balances.map((balance) => {
        const cost = costs.get(
          `${balance.locationId}:${balance.inventoryItemId}`,
        );
        return {
          locationId: balance.locationId,
          inventoryItemId: balance.inventoryItemId,
          quantityMicros: (balance._sum.quantityDeltaMicros ?? 0n).toString(),
          netReceivedBaseMicros: (cost?.base ?? 0n).toString(),
          netReceivedCostMinor: (cost?.minor ?? 0n).toString(),
          weightedAverageCostNumerator: (
            (cost?.minor ?? 0n) * oneUnitMicros
          ).toString(),
          weightedAverageCostDenominator: (cost?.base ?? 0n).toString(),
          lastPurchaseUnitCostMinor: cost?.lastUnitCostMinor ?? null,
        };
      }),
    };
  }

  private async conversion(
    tx: Tx,
    organizationId: string,
    fromUnitId: string,
    toUnitId: string,
  ) {
    const direct = await tx.inventoryUnitConversion.findFirst({
      where: { organizationId, fromUnitId, toUnitId },
    });
    if (direct)
      return { numerator: direct.numerator, denominator: direct.denominator };
    const inverse = await tx.inventoryUnitConversion.findFirst({
      where: { organizationId, fromUnitId: toUnitId, toUnitId: fromUnitId },
    });
    if (inverse)
      return { numerator: inverse.denominator, denominator: inverse.numerator };
    throw new ConflictException({ code: "PURCHASE_UNIT_CONVERSION_MISSING" });
  }

  private async assertNonNegative(
    tx: Tx,
    branchId: string,
    locationId: string,
    itemId: string,
    delta: bigint,
    override: boolean,
    principal: AuthPrincipal,
  ) {
    const aggregate = await tx.stockLedgerEntry.aggregate({
      where: { branchId, locationId, inventoryItemId: itemId },
      _sum: { quantityDeltaMicros: true },
    });
    if ((aggregate._sum.quantityDeltaMicros ?? 0n) + delta >= 0n) return;
    if (!override)
      throw new ConflictException({
        code: "NEGATIVE_STOCK_POLICY_UNCONFIRMED",
      });
    this.permission(principal, "procurement.manage", branchId);
  }

  private async branch(
    branchId: string,
    principal: AuthPrincipal,
    tx: Tx | PrismaService = this.prisma,
    includeCurrency = false,
  ) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, organizationId: principal.organizationId },
      select: {
        id: true,
        organizationId: true,
        ...(includeCurrency ? { currency: true } : {}),
      },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    return branch as { id: string; organizationId: string; currency: string };
  }

  private permission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId))
      throw new ForbiddenException("Permission denied for branch.");
  }
  private result(
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
  ): Result {
    return { entityId, eventType, reason, response };
  }
  private async idempotent(
    scope: string,
    key: string,
    command: { branchId: string } & Record<string, unknown>,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<Result>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await work(tx);
          const response = asJson(result.response);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: command.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "procurement",
              entityId: result.entityId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                eventType: result.eventType,
              },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "procurement",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: command.branchId,
                procurementEntityId: result.entityId,
              },
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hash,
              responseBody: response,
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2004", "P2034"].includes(error.code)
      ) {
        throw new ConflictException({ code: "PROCUREMENT_CONFLICT" });
      }
      throw error;
    }
  }
}
