import { randomUUID } from "node:crypto";

import type {
  MergeOrdersRequest,
  MoveOrderTableRequest,
  SplitOrderRequest,
  TransferOrderResponsibilityRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderEventType,
  OrderLineStatus,
  OrderStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { calculateOrder } from "./order-calculator.js";
import { officialOrderNumber } from "./order-policy.js";

type Tx = Prisma.TransactionClient;
type SnapshotLine = Prisma.OrderLineGetPayload<{
  include: { modifiers: true };
}>;
type WorkResult = Readonly<{
  branchId: string;
  primaryOrderId: string;
  affectedOrderIds: readonly string[];
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
  metadata?: Prisma.InputJsonObject;
}>;

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function fail(
  code: string,
  message: string,
  Kind:
    typeof ConflictException | typeof BadRequestException = ConflictException,
): never {
  throw new Kind({ code, message });
}

function sameDate(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

@Injectable()
export class OrderOperationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async options(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "orders.owner.transfer", branchId);
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    const staff = await this.prisma.user.findMany({
      where: {
        organizationId: principal.organizationId,
        status: UserStatus.ACTIVE,
        roles: {
          some: {
            revokedAt: null,
            OR: [
              { branchId },
              { branchId: null, role: { scope: "ORGANIZATION" } },
            ],
          },
        },
      },
      select: { id: true, displayName: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
    return { staff };
  }

  moveTable(
    orderId: string,
    input: MoveOrderTableRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.table.move", input.branchId);
    return this.idempotent(
      "orders.table.move",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await this.activeOrder(
          tx,
          orderId,
          input.branchId,
          input.revision,
          principal,
          [OrderStatus.OPEN, OrderStatus.HELD],
        );
        if (!["DINE_IN", "BAR_TAB"].includes(order.channel))
          fail(
            "ORDER_CHANNEL_TABLE_INVALID",
            "Only dine-in and bar-tab orders can attach a table.",
            BadRequestException,
          );
        if (order.tableId === input.tableId)
          fail("TABLE_MOVE_NO_CHANGE", "The order is already at that table.");
        if (input.tableId)
          await this.activeTable(tx, input.tableId, input.branchId);
        const occupied = input.tableId
          ? await tx.order.findMany({
              where: {
                id: { not: order.id },
                tableId: input.tableId,
                status: { in: [OrderStatus.OPEN, OrderStatus.HELD] },
              },
              select: { id: true },
              orderBy: { id: "asc" },
            })
          : [];
        this.validateTableConflict(
          occupied,
          input.allowTableConflict,
          input.branchId,
          principal,
        );
        const updated = await tx.order.updateMany({
          where: {
            id: order.id,
            revision: input.revision,
            status: order.status,
          },
          data: {
            tableId: input.tableId,
            tableConflictOverride: occupied.length > 0,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stale();
        const revision = input.revision + 1;
        await tx.orderTableMovement.create({
          data: {
            id: input.operationId,
            branchId: input.branchId,
            orderId: order.id,
            fromTableId: order.tableId,
            toTableId: input.tableId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            conflictOverride: occupied.length > 0,
            conflictingOrderIds: occupied.length
              ? occupied.map(({ id }) => id)
              : Prisma.JsonNull,
            reason: input.reason,
          },
        });
        await this.event(
          tx,
          order.id,
          principal,
          OrderEventType.TABLE_MOVED,
          revision,
          input.reason,
          {
            operationId: input.operationId,
            fromTableId: order.tableId,
            toTableId: input.tableId,
            conflictingOrderIds: occupied.map(({ id }) => id),
          },
        );
        return this.result(
          input.branchId,
          order.id,
          [order.id],
          "order.table_moved",
          {
            orderId: order.id,
            revision,
            tableId: input.tableId,
            movementId: input.operationId,
            conflictingOrderIds: occupied.map(({ id }) => id),
          },
          input.reason,
          { movementId: input.operationId, conflictCount: occupied.length },
        );
      },
    );
  }

  transferResponsibility(
    orderId: string,
    input: TransferOrderResponsibilityRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.owner.transfer", input.branchId);
    return this.idempotent(
      "orders.owner.transfer",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await this.activeOrder(
          tx,
          orderId,
          input.branchId,
          input.revision,
          principal,
          [OrderStatus.OPEN, OrderStatus.HELD],
        );
        if (order.assignedServerId === input.receivingUserId)
          fail(
            "ORDER_RESPONSIBILITY_NO_CHANGE",
            "The selected staff member already owns this order.",
          );
        const receivingUser = await tx.user.findFirst({
          where: {
            id: input.receivingUserId,
            organizationId: principal.organizationId,
            status: UserStatus.ACTIVE,
            roles: {
              some: {
                revokedAt: null,
                OR: [
                  { branchId: input.branchId },
                  { branchId: null, role: { scope: "ORGANIZATION" } },
                ],
              },
            },
          },
          select: { id: true, displayName: true },
        });
        if (!receivingUser)
          fail(
            "ORDER_RECEIVING_USER_UNAVAILABLE",
            "The receiving staff member is inactive or not assigned to this branch.",
            BadRequestException,
          );
        const updated = await tx.order.updateMany({
          where: {
            id: order.id,
            revision: input.revision,
            status: order.status,
          },
          data: {
            assignedServerId: receivingUser.id,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stale();
        const revision = input.revision + 1;
        await tx.orderResponsibilityTransfer.create({
          data: {
            id: input.operationId,
            branchId: input.branchId,
            orderId: order.id,
            fromUserId: order.assignedServerId,
            toUserId: receivingUser.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
          },
        });
        await this.event(
          tx,
          order.id,
          principal,
          OrderEventType.RESPONSIBILITY_TRANSFERRED,
          revision,
          input.reason,
          {
            operationId: input.operationId,
            fromUserId: order.assignedServerId,
            toUserId: receivingUser.id,
          },
        );
        return this.result(
          input.branchId,
          order.id,
          [order.id],
          "order.responsibility_transferred",
          {
            orderId: order.id,
            revision,
            transferId: input.operationId,
            assignedServer: receivingUser,
          },
          input.reason,
          { transferId: input.operationId, toUserId: receivingUser.id },
        );
      },
    );
  }

  merge(
    targetOrderId: string,
    input: MergeOrdersRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.split-merge", input.branchId);
    return this.idempotent(
      "orders.merge",
      key,
      { targetOrderId, ...input },
      principal,
      async (tx) => {
        if (targetOrderId === input.sourceOrderId)
          fail("ORDER_MERGE_SELF", "An order cannot be merged into itself.");
        const target = await this.activeOrder(
          tx,
          targetOrderId,
          input.branchId,
          input.targetRevision,
          principal,
          [OrderStatus.OPEN],
        );
        const source = await this.activeOrder(
          tx,
          input.sourceOrderId,
          input.branchId,
          input.sourceRevision,
          principal,
          [OrderStatus.OPEN],
        );
        if (await tx.orderMerge.count({ where: { targetOrderId: source.id } }))
          fail(
            "ORDER_MERGE_NESTED_UNSUPPORTED",
            "An order that already contains merged sources cannot become a merge source.",
          );
        if (
          target.shiftId !== source.shiftId ||
          !sameDate(target.businessDate, source.businessDate) ||
          target.currency !== source.currency ||
          target.channel !== source.channel ||
          target.taxProfileId !== source.taxProfileId
        )
          fail(
            "ORDER_MERGE_INCOMPATIBLE",
            "Orders must share the same open shift, business date, currency, channel, and pinned tax profile.",
          );
        if (target.shift.status !== "OPEN" || source.shift.status !== "OPEN")
          fail(
            "ORDER_SHIFT_NOT_OPEN",
            "Both orders require the same open shift.",
          );
        await tx.orderMerge.create({
          data: {
            id: input.mergeId,
            branchId: input.branchId,
            targetOrderId: target.id,
            sourceOrderId: source.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
          },
        });
        const targetUpdate = await tx.order.updateMany({
          where: {
            id: target.id,
            revision: input.targetRevision,
            status: OrderStatus.OPEN,
          },
          data: { revision: { increment: 1 } },
        });
        const sourceUpdate = await tx.order.updateMany({
          where: {
            id: source.id,
            revision: input.sourceRevision,
            status: OrderStatus.OPEN,
          },
          data: {
            status: OrderStatus.MERGED,
            mergedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (targetUpdate.count !== 1 || sourceUpdate.count !== 1) this.stale();
        const targetRevision = input.targetRevision + 1;
        const sourceRevision = input.sourceRevision + 1;
        await this.event(
          tx,
          target.id,
          principal,
          OrderEventType.MERGE_RECEIVED,
          targetRevision,
          input.reason,
          { mergeId: input.mergeId, sourceOrderId: source.id },
        );
        await this.event(
          tx,
          source.id,
          principal,
          OrderEventType.MERGED_INTO,
          sourceRevision,
          input.reason,
          { mergeId: input.mergeId, targetOrderId: target.id },
        );
        const priorSources = await tx.orderMerge.findMany({
          where: { targetOrderId: target.id },
          include: { source: true },
        });
        const totals = this.sumTotals([
          target,
          ...priorSources.map(({ source }) => source),
        ]);
        return this.result(
          input.branchId,
          target.id,
          [target.id, source.id],
          "order.merged",
          {
            mergeId: input.mergeId,
            targetOrderId: target.id,
            sourceOrderId: source.id,
            targetRevision,
            sourceRevision,
            compositionTotals: totals,
          },
          input.reason,
          { mergeId: input.mergeId, sourceOrderId: source.id },
        );
      },
    );
  }

  split(
    sourceOrderId: string,
    input: SplitOrderRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.split-merge", input.branchId);
    return this.idempotent(
      "orders.split",
      key,
      { sourceOrderId, ...input },
      principal,
      async (tx) => {
        const source = await this.activeOrder(
          tx,
          sourceOrderId,
          input.branchId,
          input.sourceRevision,
          principal,
          [OrderStatus.OPEN],
        );
        if (source.shift.status !== "OPEN")
          fail("ORDER_SHIFT_NOT_OPEN", "The source order shift is closed.");
        if (source.deviceId !== principal.deviceId)
          fail(
            "ORDER_SHIFT_NOT_OPEN",
            "The split must be created on the source order device.",
          );
        if (!source.taxProfileId)
          fail(
            "TAX_CONFIGURATION_MISSING",
            "An order with priced lines must have a pinned tax profile.",
          );
        if (await tx.orderMerge.count({ where: { targetOrderId: source.id } }))
          fail(
            "ORDER_COMPOSITION_ACTIVE",
            "Split a composed bill before merging its source orders.",
          );
        if (input.tableId && !["DINE_IN", "BAR_TAB"].includes(source.channel))
          fail(
            "ORDER_CHANNEL_TABLE_INVALID",
            "Only dine-in and bar-tab child orders can attach a table.",
            BadRequestException,
          );
        if (input.tableId)
          await this.activeTable(tx, input.tableId, input.branchId);
        const occupied = input.tableId
          ? await tx.order.findMany({
              where: {
                tableId: input.tableId,
                status: { in: [OrderStatus.OPEN, OrderStatus.HELD] },
              },
              select: { id: true },
              orderBy: { id: "asc" },
            })
          : [];
        this.validateTableConflict(
          occupied,
          input.allowTableConflict,
          input.branchId,
          principal,
        );
        const selectedIds = input.lines.map(({ sourceLineId }) => sourceLineId);
        const sourceLines = await tx.orderLine.findMany({
          where: { id: { in: selectedIds }, orderId: source.id },
          include: { modifiers: true },
        });
        if (sourceLines.length !== selectedIds.length)
          fail(
            "ORDER_SPLIT_LINE_INVALID",
            "Every selected line must belong to the source order.",
            BadRequestException,
          );
        const byId = new Map(sourceLines.map((line) => [line.id, line]));
        for (const selection of input.lines) {
          const line = byId.get(selection.sourceLineId)!;
          if (
            line.status !== OrderLineStatus.DRAFT ||
            line.sentAt !== null ||
            line.sentCancelledAt !== null
          )
            fail(
              "SENT_LINE_IMMUTABLE",
              "Sent or inactive line versions cannot be split; cancel and replace them explicitly.",
            );
          if (selection.quantity > line.quantity)
            fail(
              "ORDER_SPLIT_QUANTITY_INVALID",
              "A split quantity cannot exceed the source quantity.",
              BadRequestException,
            );
          const partial = selection.quantity < line.quantity;
          if (partial !== Boolean(selection.remainderLineId))
            fail(
              "ORDER_SPLIT_REMAINDER_ID_INVALID",
              partial
                ? "A partial quantity split requires a client-generated remainder line ID."
                : "A full-line split must not provide a remainder line ID.",
              BadRequestException,
            );
        }
        const sequence = await tx.branchOrderSequence.upsert({
          where: {
            branchId_businessDate: {
              branchId: input.branchId,
              businessDate: source.businessDate,
            },
          },
          create: {
            branchId: input.branchId,
            businessDate: source.businessDate,
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
        });
        const child = await tx.order.create({
          data: {
            id: input.newOrderId,
            branchId: source.branchId,
            shiftId: source.shiftId,
            deviceId: source.deviceId,
            createdById: principal.userId,
            assignedServerId: source.assignedServerId,
            taxProfileId: source.taxProfileId,
            tableId: input.tableId ?? null,
            channel: source.channel,
            businessDate: source.businessDate,
            currency: source.currency,
            orderSequence: sequence.lastValue,
            orderNumber: officialOrderNumber(
              source.businessDate,
              sequence.lastValue,
            ),
            clientReference: input.newClientReference,
            guestCount: source.guestCount,
            pickupReference: source.pickupReference,
            customerReference: source.customerReference,
            customerPhone: source.customerPhone,
            deliveryDirections: source.deliveryDirections,
            tabName: source.tabName,
            note: source.note,
            tableConflictOverride: occupied.length > 0,
            taxProfileKeySnapshot: source.taxProfileKeySnapshot,
            taxProfileNameSnapshot: source.taxProfileNameSnapshot,
            taxProfileRevision: source.taxProfileRevision,
            taxPriceMode: source.taxPriceMode,
            taxRoundingMode: source.taxRoundingMode,
            taxRoundingScope: source.taxRoundingScope,
          },
        });
        await tx.orderSplit.create({
          data: {
            id: input.splitId,
            branchId: input.branchId,
            sourceOrderId: source.id,
            childOrderId: child.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
          },
        });
        for (const selection of input.lines) {
          const line = byId.get(selection.sourceLineId)!;
          await tx.orderLine.update({
            where: { id: line.id },
            data: {
              status: OrderLineStatus.REPLACED,
              endedAt: new Date(),
            },
          });
          let remainderLineId: string | null = null;
          if (selection.quantity < line.quantity) {
            remainderLineId = selection.remainderLineId!;
            await this.cloneLine(
              tx,
              line,
              remainderLineId,
              source.id,
              line.quantity - selection.quantity,
              principal.userId,
              line.id,
            );
          }
          await this.cloneLine(
            tx,
            line,
            selection.targetLineId,
            child.id,
            selection.quantity,
            principal.userId,
            null,
          );
          await tx.orderSplitLine.create({
            data: {
              splitId: input.splitId,
              sourceLineId: line.id,
              targetLineId: selection.targetLineId,
              remainderLineId,
              sourceQuantity: line.quantity,
              movedQuantity: selection.quantity,
            },
          });
        }
        const profile = await tx.taxProfile.findUnique({
          where: { id: source.taxProfileId },
          include: { components: true },
        });
        if (!profile)
          fail(
            "TAX_CONFIGURATION_MISSING",
            "The pinned tax profile is unavailable.",
          );
        const sourceRevision = await this.recalculate(
          tx,
          source.id,
          profile,
          input.sourceRevision,
        );
        const childRevision = await this.recalculate(tx, child.id, profile, 1);
        await this.event(
          tx,
          source.id,
          principal,
          OrderEventType.SPLIT_CREATED,
          sourceRevision,
          input.reason,
          { splitId: input.splitId, childOrderId: child.id },
        );
        await this.event(
          tx,
          child.id,
          principal,
          OrderEventType.SPLIT_RECEIVED,
          childRevision,
          input.reason,
          { splitId: input.splitId, sourceOrderId: source.id },
        );
        const [sourceResult, childResult] = await Promise.all([
          tx.order.findUniqueOrThrow({ where: { id: source.id } }),
          tx.order.findUniqueOrThrow({ where: { id: child.id } }),
        ]);
        return this.result(
          input.branchId,
          source.id,
          [source.id, child.id],
          "order.split",
          {
            splitId: input.splitId,
            sourceOrderId: source.id,
            childOrderId: child.id,
            childOrderNumber: child.orderNumber,
            sourceRevision,
            childRevision,
            sourceTotals: this.sumTotals([sourceResult]),
            childTotals: this.sumTotals([childResult]),
            movedLines: input.lines,
          },
          input.reason,
          { splitId: input.splitId, childOrderId: child.id },
        );
      },
    );
  }

  private async cloneLine(
    tx: Tx,
    source: SnapshotLine,
    id: string,
    orderId: string,
    quantity: number,
    actorId: string,
    replacesLineId: string | null,
  ) {
    const lineInputAmountMinor = source.unitInputAmountMinor * quantity;
    await tx.orderLine.create({
      data: {
        id,
        orderId,
        replacesLineId,
        createdById: actorId,
        menuItemId: source.menuItemId,
        variantId: source.variantId,
        stationId: source.stationId,
        taxClassId: source.taxClassId,
        status: OrderLineStatus.DRAFT,
        quantity,
        note: source.note,
        itemNameSnapshot: source.itemNameSnapshot,
        itemSkuSnapshot: source.itemSkuSnapshot,
        categoryKeySnapshot: source.categoryKeySnapshot,
        categoryNameSnapshot: source.categoryNameSnapshot,
        variantNameSnapshot: source.variantNameSnapshot,
        stationNameSnapshot: source.stationNameSnapshot,
        taxClassKeySnapshot: source.taxClassKeySnapshot,
        taxClassLabelSnapshot: source.taxClassLabelSnapshot,
        taxTreatmentSnapshot: source.taxTreatmentSnapshot,
        baseUnitPriceMinor: source.baseUnitPriceMinor,
        modifierUnitTotalMinor: source.modifierUnitTotalMinor,
        unitInputAmountMinor: source.unitInputAmountMinor,
        lineInputAmountMinor,
        netAmountMinor: lineInputAmountMinor,
        taxTotalMinor: 0,
        grossAmountMinor: lineInputAmountMinor,
        modifiers: {
          create: source.modifiers.map((modifier) => ({
            id: randomUUID(),
            menuModifierId: modifier.menuModifierId,
            modifierGroupId: modifier.modifierGroupId,
            stationId: modifier.stationId,
            modifierNameSnapshot: modifier.modifierNameSnapshot,
            modifierGroupNameSnapshot: modifier.modifierGroupNameSnapshot,
            stationNameSnapshot: modifier.stationNameSnapshot,
            quantity: modifier.quantity,
            configuredDeltaMinor: modifier.configuredDeltaMinor,
            chargedDeltaMinor: modifier.chargedDeltaMinor,
            isFree: modifier.isFree,
          })),
        },
      },
    });
  }

  private async recalculate(
    tx: Tx,
    orderId: string,
    profile: Prisma.TaxProfileGetPayload<{ include: { components: true } }>,
    expectedRevision: number,
  ) {
    const lines = await tx.orderLine.findMany({
      where: { orderId, status: OrderLineStatus.DRAFT },
    });
    const calculated = calculateOrder(
      lines.map((line) => ({
        id: line.id,
        amountMinor: line.lineInputAmountMinor,
        treatment: line.taxTreatmentSnapshot,
      })),
      {
        priceMode: profile.priceMode,
        roundingMode: profile.roundingMode,
        roundingScope: profile.roundingScope,
        components: profile.components,
      },
    );
    for (const line of lines) {
      const value = calculated.lines.get(line.id)!;
      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          netAmountMinor: value.netAmountMinor,
          taxTotalMinor: value.taxTotalMinor,
          grossAmountMinor: value.grossAmountMinor,
        },
      });
      for (const component of value.components) {
        await tx.orderLineTaxComponent.upsert({
          where: {
            orderLineId_codeSnapshot: {
              orderLineId: line.id,
              codeSnapshot: component.code,
            },
          },
          create: {
            orderLineId: line.id,
            taxProfileComponentId: component.id!,
            codeSnapshot: component.code,
            receiptLabelSnapshot: component.receiptLabel,
            ratePpmSnapshot: component.ratePpm,
            calculationOrderSnapshot: component.calculationOrder,
            taxableBaseMinor: component.taxableBaseMinor,
            amountMinor: component.amountMinor,
            roundingAdjustmentMinor: component.roundingAdjustmentMinor,
          },
          update: {
            taxableBaseMinor: component.taxableBaseMinor,
            amountMinor: component.amountMinor,
            roundingAdjustmentMinor: component.roundingAdjustmentMinor,
          },
        });
      }
    }
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        revision: expectedRevision,
        status: OrderStatus.OPEN,
      },
      data: { revision: { increment: 1 }, ...calculated.totals },
    });
    if (updated.count !== 1) this.stale();
    return expectedRevision + 1;
  }

  private async activeOrder(
    tx: Tx,
    orderId: string,
    branchId: string,
    revision: number,
    principal: AuthPrincipal,
    statuses: readonly OrderStatus[],
  ) {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: { shift: { select: { status: true } } },
    });
    if (!order) throw new NotFoundException("Order not found.");
    if (order.revision !== revision) this.stale();
    if (!statuses.includes(order.status))
      fail(
        "ORDER_STATE_INVALID",
        `The order cannot use this operation while ${order.status}.`,
      );
    return order;
  }

  private async activeTable(tx: Tx, tableId: string, branchId: string) {
    const table = await tx.diningTable.findFirst({
      where: { id: tableId, branchId, isActive: true },
      select: { id: true },
    });
    if (!table)
      fail(
        "TABLE_UNAVAILABLE",
        "The selected table is inactive or outside the branch.",
        BadRequestException,
      );
  }

  private validateTableConflict(
    occupied: readonly { id: string }[],
    allowed: boolean,
    branchId: string,
    principal: AuthPrincipal,
  ) {
    if (!occupied.length) return;
    if (!allowed)
      fail("TABLE_OCCUPIED", "The table already has an active order.");
    if (!hasPermission(principal, "orders.manage", branchId))
      throw new ForbiddenException({
        code: "TABLE_OCCUPIED",
        message: "orders.manage is required to override table occupancy.",
      });
  }

  private sumTotals(
    orders: readonly {
      inputSubtotalMinor: number;
      netTotalMinor: number;
      taxTotalMinor: number;
      grossTotalMinor: number;
    }[],
  ) {
    return orders.reduce(
      (total, order) => ({
        inputSubtotalMinor: total.inputSubtotalMinor + order.inputSubtotalMinor,
        netTotalMinor: total.netTotalMinor + order.netTotalMinor,
        taxTotalMinor: total.taxTotalMinor + order.taxTotalMinor,
        grossTotalMinor: total.grossTotalMinor + order.grossTotalMinor,
      }),
      {
        inputSubtotalMinor: 0,
        netTotalMinor: 0,
        taxTotalMinor: 0,
        grossTotalMinor: 0,
      },
    );
  }

  private event(
    tx: Tx,
    orderId: string,
    principal: AuthPrincipal,
    type: OrderEventType,
    revision: number,
    reason: string,
    data: Prisma.InputJsonObject,
  ) {
    return tx.orderEvent.create({
      data: {
        orderId,
        actorId: principal.userId,
        deviceId: principal.deviceId,
        type,
        revision,
        reason,
        data,
      },
    });
  }

  private permission(principal: AuthPrincipal, key: string, branchId: string) {
    if (!hasPermission(principal, key, branchId))
      throw new ForbiddenException(
        "The user lacks permission for the requested branch.",
      );
  }

  private stale(): never {
    fail("STALE_REVISION", "The order changed since it was read.");
  }

  private result(
    branchId: string,
    primaryOrderId: string,
    affectedOrderIds: readonly string[],
    eventType: string,
    response: unknown,
    reason: string,
    metadata?: Prisma.InputJsonObject,
  ): WorkResult {
    return {
      branchId,
      primaryOrderId,
      affectedOrderIds,
      eventType,
      response: json(response),
      reason,
      metadata,
    };
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<WorkResult>,
  ) {
    const hashValue = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hashValue)
        fail(
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key was already used with a different request.",
        );
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await work(tx);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: result.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "order",
              entityId: result.primaryOrderId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                affectedOrderIds: result.affectedOrderIds,
                ...(result.metadata ?? {}),
              },
            },
          });
          await tx.outboxEvent.createMany({
            data: [...new Set(result.affectedOrderIds)].map((orderId) => ({
              aggregateType: "order",
              aggregateId: orderId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: result.branchId,
                orderId,
                primaryOrderId: result.primaryOrderId,
              },
            })),
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hashValue,
              responseBody: result.response,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          });
          return result.response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2004", "P2034"].includes(error.code)
      )
        fail(
          error.code === "P2002"
            ? "ORDER_OPERATION_CONFLICT"
            : "ORDER_CONFLICT",
          "The operation conflicts with retained lineage or a concurrent change.",
        );
      throw error;
    }
  }
}
