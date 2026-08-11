import type {
  CancelSentOrderLineRequest,
  SendOrderWaveRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  InventoryDeductionTrigger,
  OrderEventType,
  OrderLineStatus,
  PreparationTicketStatus,
  Prisma,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { InventoryConsumptionService } from "../inventory-consumption/inventory-consumption.service.js";
import { routePreparationEntries } from "../kds/kds-policy.js";
import { calculateOrder } from "./order-calculator.js";

type Tx = Prisma.TransactionClient;

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

@Injectable()
export class OrderSendingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(InventoryConsumptionService)
    private readonly inventoryConsumption?: InventoryConsumptionService,
  ) {}

  async send(
    orderId: string,
    input: SendOrderWaveRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.send", input.branchId);
    return this.idempotent(
      "orders.send_wave",
      key,
      { orderId, ...input },
      principal,
      input.branchId,
      orderId,
      "order.send_wave_created",
      async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: {
            shift: {
              select: {
                status: true,
                deviceId: true,
                currentCashierId: true,
              },
            },
            table: { select: { name: true } },
            createdBy: { select: { displayName: true } },
            assignedServer: { select: { displayName: true } },
            lines: {
              where: { id: { in: input.lineIds } },
              include: { modifiers: true },
            },
          },
        });
        if (!order) throw new NotFoundException("Order not found.");
        if (order.revision !== input.orderRevision)
          conflict("STALE_REVISION", "The order changed since it was read.");
        if (
          order.status !== "OPEN" ||
          order.deviceId !== principal.deviceId ||
          order.shift.status !== "OPEN" ||
          order.shift.deviceId !== principal.deviceId ||
          order.shift.currentCashierId !== principal.userId
        )
          conflict(
            "ORDER_STATE_INVALID",
            "Only an open order on its authenticated device can be sent.",
          );
        if (
          order.lines.length !== input.lineIds.length ||
          order.lines.some(
            (line) =>
              line.status !== OrderLineStatus.DRAFT ||
              line.sentAt !== null ||
              line.sentCancelledAt !== null,
          )
        )
          conflict(
            "SEND_LINE_INVALID",
            "Every selected line must be an active, unsent draft snapshot.",
          );

        const routed = routePreparationEntries(order.lines);
        if (routed.issue)
          conflict(
            routed.issue,
            "Every sent item or separately routed modifier requires a station snapshot.",
          );
        const stations = routed.stations;
        if (!stations || stations.size === 0)
          conflict(
            "PREPARATION_STATION_MISSING",
            "The send wave produced no station tickets.",
          );

        const latest = await tx.orderSendWave.aggregate({
          where: { orderId },
          _max: { waveNumber: true },
        });
        const waveNumber = (latest._max.waveNumber ?? 0) + 1;
        const sentAt = new Date();
        const serviceReference =
          order.table?.name ??
          order.tabName ??
          order.pickupReference ??
          order.customerReference ??
          null;
        const sendWave = await tx.orderSendWave.create({
          data: {
            id: input.sendWaveId,
            orderId,
            branchId: input.branchId,
            sentById: principal.userId,
            deviceId: principal.deviceId,
            waveNumber,
            reason: input.reason,
            sentAt,
            tickets: {
              create: [...stations.entries()].map(([stationId, station]) => ({
                branchId: input.branchId,
                stationId,
                orderId,
                status: PreparationTicketStatus.QUEUED,
                orderNumberSnapshot: order.orderNumber,
                channelSnapshot: order.channel,
                serviceReferenceSnapshot: serviceReference,
                cashierNameSnapshot: order.assignedServer.displayName,
                stationNameSnapshot: station.stationName,
                businessDate: order.businessDate,
                queuedAt: sentAt,
                entries: {
                  create: station.entries.map((entry) => ({
                    orderLineId: entry.orderLineId,
                    orderLineModifierId: entry.orderLineModifierId,
                    kind: entry.kind,
                    quantity: entry.quantity,
                    itemNameSnapshot: entry.itemNameSnapshot,
                    variantNameSnapshot: entry.variantNameSnapshot,
                    modifierNameSnapshot: entry.modifierNameSnapshot,
                    modifierGroupSnapshot: entry.modifierGroupSnapshot,
                    modifierSummary:
                      entry.modifierSummary === null
                        ? Prisma.JsonNull
                        : json(entry.modifierSummary),
                    noteSnapshot: entry.noteSnapshot,
                  })),
                },
                events: {
                  create: {
                    actorId: principal.userId,
                    deviceId: principal.deviceId,
                    fromStatus: null,
                    toStatus: PreparationTicketStatus.QUEUED,
                    revision: 1,
                    reason: input.reason,
                  },
                },
              })),
            },
          },
          include: { tickets: { include: { entries: true } } },
        });
        for (const lineId of input.lineIds) {
          const updated = await tx.orderLine.updateMany({
            where: {
              id: lineId,
              orderId,
              status: OrderLineStatus.DRAFT,
              sentAt: null,
            },
            data: { sendWaveId: input.sendWaveId, sentAt },
          });
          if (updated.count !== 1)
            conflict(
              "SEND_LINE_INVALID",
              "A selected line was concurrently changed or sent.",
            );
        }
        const updatedOrder = await tx.order.updateMany({
          where: { id: orderId, revision: input.orderRevision, status: "OPEN" },
          data: { revision: { increment: 1 } },
        });
        if (updatedOrder.count !== 1)
          conflict("STALE_REVISION", "The order changed since it was read.");
        await tx.orderEvent.create({
          data: {
            orderId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: OrderEventType.SEND_WAVE_CREATED,
            revision: input.orderRevision + 1,
            reason: input.reason,
            data: {
              sendWaveId: input.sendWaveId,
              waveNumber,
              lineIds: input.lineIds,
              ticketIds: sendWave.tickets.map(({ id }) => id),
            },
          },
        });
        const inventory = await this.inventoryConsumption?.postAutomatically(
          tx,
          {
            branchId: input.branchId,
            orderLineIds: input.lineIds,
            sourceEventId: sendWave.id,
            trigger: InventoryDeductionTrigger.SENT,
            occurredAt: sentAt,
            reason: input.reason,
          },
          principal,
        );
        return {
          sendWave,
          orderRevision: input.orderRevision + 1,
          inventory,
        };
      },
    );
  }

  async cancelSentLine(
    orderId: string,
    lineId: string,
    input: CancelSentOrderLineRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.manage", input.branchId);
    return this.idempotent(
      "orders.sent_line.cancel",
      key,
      { orderId, lineId, ...input },
      principal,
      input.branchId,
      orderId,
      "order.sent_line_cancelled",
      async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (!order) throw new NotFoundException("Order not found.");
        if (order.revision !== input.orderRevision)
          conflict("STALE_REVISION", "The order changed since it was read.");
        if (order.status !== "OPEN")
          conflict(
            "ORDER_STATE_INVALID",
            "Sent lines can only be cancelled on an open order.",
          );
        const line = await tx.orderLine.findFirst({
          where: { id: lineId, orderId },
        });
        if (
          !line ||
          line.status !== OrderLineStatus.DRAFT ||
          line.sentAt === null ||
          line.sentCancelledAt !== null
        )
          conflict(
            "SENT_LINE_INVALID",
            "The line is not an active sent snapshot.",
          );

        const affectedEntries = await tx.preparationTicketEntry.findMany({
          where: { orderLineId: lineId, cancelledAt: null },
          select: { ticketId: true },
        });
        const affectedTicketIds = [
          ...new Set(affectedEntries.map(({ ticketId }) => ticketId)),
        ];
        const at = new Date();
        await tx.orderSentLineCancellation.create({
          data: {
            id: input.cancellationId,
            orderId,
            orderLineId: lineId,
            approvedById: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
            createdAt: at,
          },
        });
        const lineUpdate = await tx.orderLine.updateMany({
          where: {
            id: lineId,
            orderId,
            status: OrderLineStatus.DRAFT,
            sentCancelledAt: null,
          },
          data: {
            status: OrderLineStatus.CANCELLED,
            sentCancelledAt: at,
            endedAt: at,
          },
        });
        if (lineUpdate.count !== 1)
          conflict(
            "SENT_LINE_INVALID",
            "The sent line was concurrently changed.",
          );
        await tx.preparationTicketEntry.updateMany({
          where: { orderLineId: lineId, cancelledAt: null },
          data: { cancellationId: input.cancellationId, cancelledAt: at },
        });

        for (const ticketId of affectedTicketIds) {
          const ticket = await tx.preparationTicket.findUnique({
            where: { id: ticketId },
          });
          if (!ticket) continue;
          const activeEntries = await tx.preparationTicketEntry.count({
            where: { ticketId, cancelledAt: null },
          });
          const canCancelTicket =
            activeEntries === 0 &&
            ["QUEUED", "PREPARING", "READY"].includes(ticket.status);
          if (canCancelTicket) {
            await tx.preparationTicket.update({
              where: { id: ticketId },
              data: {
                status: PreparationTicketStatus.CANCELLED,
                cancelledAt: at,
                revision: { increment: 1 },
              },
            });
          }
          await tx.preparationTicketEvent.create({
            data: {
              ticketId,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              fromStatus: ticket.status,
              toStatus: canCancelTicket
                ? PreparationTicketStatus.CANCELLED
                : ticket.status,
              revision: ticket.revision + (canCancelTicket ? 1 : 0),
              reason: input.reason,
              data: {
                event: "SENT_LINE_CANCELLED",
                orderLineId: lineId,
                cancellationId: input.cancellationId,
              },
            },
          });
        }

        const totals = await this.recalculateActiveLines(
          tx,
          orderId,
          order.taxProfileId,
        );
        const orderUpdate = await tx.order.updateMany({
          where: { id: orderId, revision: input.orderRevision, status: "OPEN" },
          data: { ...totals, revision: { increment: 1 } },
        });
        if (orderUpdate.count !== 1)
          conflict("STALE_REVISION", "The order changed since it was read.");
        await tx.orderEvent.create({
          data: {
            orderId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: OrderEventType.SENT_LINE_CANCELLED,
            revision: input.orderRevision + 1,
            reason: input.reason,
            data: {
              lineId,
              cancellationId: input.cancellationId,
              affectedTicketIds,
            },
          },
        });
        const inventory = await this.inventoryConsumption?.reverseAutomatically(
          tx,
          {
            branchId: input.branchId,
            orderLineId: lineId,
            cancellationId: input.cancellationId,
            reason: input.reason,
            occurredAt: at,
          },
          principal,
        );
        return {
          orderId,
          lineId,
          cancellationId: input.cancellationId,
          affectedTicketIds,
          orderRevision: input.orderRevision + 1,
          totals,
          inventory,
        };
      },
    );
  }

  private async recalculateActiveLines(
    tx: Tx,
    orderId: string,
    taxProfileId: string | null,
  ) {
    const lines = await tx.orderLine.findMany({
      where: { orderId, status: OrderLineStatus.DRAFT },
    });
    if (!taxProfileId || lines.length === 0)
      return {
        inputSubtotalMinor: 0,
        netTotalMinor: 0,
        taxTotalMinor: 0,
        grossTotalMinor: 0,
      };
    const profile = await tx.taxProfile.findUnique({
      where: { id: taxProfileId },
      include: { components: true },
    });
    if (!profile)
      conflict(
        "TAX_CONFIGURATION_MISSING",
        "The pinned tax profile was not found.",
      );
    const result = calculateOrder(
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
      const calculated = result.lines.get(line.id);
      if (!calculated) continue;
      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          netAmountMinor: calculated.netAmountMinor,
          taxTotalMinor: calculated.taxTotalMinor,
          grossAmountMinor: calculated.grossAmountMinor,
        },
      });
      for (const component of calculated.components) {
        await tx.orderLineTaxComponent.update({
          where: {
            orderLineId_codeSnapshot: {
              orderLineId: line.id,
              codeSnapshot: component.code,
            },
          },
          data: {
            taxableBaseMinor: component.taxableBaseMinor,
            amountMinor: component.amountMinor,
            roundingAdjustmentMinor: component.roundingAdjustmentMinor,
          },
        });
      }
    }
    return result.totals;
  }

  private permission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId))
      throw new ForbiddenException(
        "The user lacks permission for the requested branch.",
      );
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    branchId: string,
    orderId: string,
    eventType: string,
    work: (tx: Tx) => Promise<unknown>,
  ) {
    const hashValue = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: { actorId: principal.userId, scope, key },
      },
    });
    if (existing) {
      if (existing.requestHash !== hashValue)
        conflict(
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key was used with a different command.",
        );
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const response = await work(tx);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "order",
              entityId: orderId,
              reason: (command as { reason?: string }).reason,
              metadata: { deviceId: principal.deviceId },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "order",
              aggregateId: orderId,
              eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId,
                orderId,
                ...(scope === "orders.send_wave" && {
                  sendWaveId: (command as { sendWaveId: string }).sendWaveId,
                }),
                ...(scope === "orders.sent_line.cancel" && {
                  cancellationId: (command as { cancellationId: string })
                    .cancellationId,
                }),
              },
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hashValue,
              responseBody: json(response),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
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
      )
        conflict(
          "SEND_WAVE_CONFLICT",
          "The send command conflicts with another send or concurrent change.",
        );
      throw error;
    }
  }
}
