import type {
  KdsStationResponse,
  PreparationTicketQuery,
  PreparationTicketResponse,
  TransitionPreparationTicketRequest,
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
  PreparationTicketStatus,
  Prisma,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { InventoryConsumptionService } from "../inventory-consumption/inventory-consumption.service.js";
import { ticketTransitionAllowed } from "./kds-policy.js";

type Tx = Prisma.TransactionClient;

const ticketInclude = {
  entries: { orderBy: { createdAt: "asc" as const } },
  events: {
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { occurredAt: "asc" as const },
  },
} as const;

const ticketListInclude = {
  entries: { orderBy: { createdAt: "asc" as const } },
  sendWave: { select: { waveNumber: true } },
} as const;

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function modifierSummary(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, Prisma.JsonValue>;
    return typeof candidate.name === "string" &&
      typeof candidate.group === "string" &&
      typeof candidate.quantity === "number" &&
      Number.isInteger(candidate.quantity) &&
      candidate.quantity > 0
      ? [
          {
            name: candidate.name,
            group: candidate.group,
            quantity: candidate.quantity,
          },
        ]
      : [];
  });
}

function ticketResponse(ticket: {
  id: string;
  branchId: string;
  stationId: string;
  stationNameSnapshot: string;
  orderId: string;
  sendWaveId: string;
  sendWave: { waveNumber: number };
  status: PreparationTicketStatus;
  revision: number;
  orderNumberSnapshot: string;
  channelSnapshot: "DINE_IN" | "TAKEAWAY" | "PHONE_DELIVERY" | "BAR_TAB";
  serviceReferenceSnapshot: string | null;
  cashierNameSnapshot: string;
  businessDate: Date;
  queuedAt: Date;
  preparingAt: Date | null;
  readyAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  entries: readonly {
    id: string;
    orderLineId: string;
    kind: "ITEM" | "MODIFIER";
    quantity: number;
    itemNameSnapshot: string;
    variantNameSnapshot: string | null;
    modifierNameSnapshot: string | null;
    modifierGroupSnapshot: string | null;
    modifierSummary: Prisma.JsonValue;
    noteSnapshot: string | null;
    cancelledAt: Date | null;
  }[];
}): PreparationTicketResponse {
  return {
    id: ticket.id,
    branchId: ticket.branchId,
    stationId: ticket.stationId,
    stationName: ticket.stationNameSnapshot,
    orderId: ticket.orderId,
    sendWaveId: ticket.sendWaveId,
    waveNumber: ticket.sendWave.waveNumber,
    status: ticket.status,
    revision: ticket.revision,
    orderNumber: ticket.orderNumberSnapshot,
    channel: ticket.channelSnapshot,
    serviceReference: ticket.serviceReferenceSnapshot,
    cashierName: ticket.cashierNameSnapshot,
    businessDate: ticket.businessDate.toISOString().slice(0, 10),
    queuedAt: ticket.queuedAt.toISOString(),
    preparingAt: ticket.preparingAt?.toISOString() ?? null,
    readyAt: ticket.readyAt?.toISOString() ?? null,
    completedAt: ticket.completedAt?.toISOString() ?? null,
    cancelledAt: ticket.cancelledAt?.toISOString() ?? null,
    entries: ticket.entries.map((entry) => ({
      id: entry.id,
      orderLineId: entry.orderLineId,
      kind: entry.kind,
      quantity: entry.quantity,
      itemName: entry.itemNameSnapshot,
      variantName: entry.variantNameSnapshot,
      modifierName: entry.modifierNameSnapshot,
      modifierGroup: entry.modifierGroupSnapshot,
      modifierSummary: modifierSummary(entry.modifierSummary),
      note: entry.noteSnapshot,
      cancelledAt: entry.cancelledAt?.toISOString() ?? null,
    })),
  };
}

@Injectable()
export class KdsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(InventoryConsumptionService)
    private readonly inventoryConsumption?: InventoryConsumptionService,
  ) {}

  async stations(
    branchId: string,
    principal: AuthPrincipal,
  ): Promise<KdsStationResponse[]> {
    this.permission(principal, "kds.read", branchId);
    await this.branch(this.prisma, branchId, principal.organizationId);
    return this.prisma.station.findMany({
      where: { branchId, isActive: true },
      select: { id: true, name: true, kind: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  }

  async list(
    branchId: string,
    query: PreparationTicketQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "kds.read", branchId);
    await this.branch(this.prisma, branchId, principal.organizationId);
    const tickets = await this.prisma.preparationTicket.findMany({
      where: {
        branchId,
        ...(query.stationId && { stationId: query.stationId }),
        ...(query.status && { status: query.status }),
        ...(query.businessDate && {
          businessDate: dateOnly(query.businessDate),
        }),
      },
      include: ticketListInclude,
      orderBy: { queuedAt: "asc" },
      take: query.limit,
    });
    return tickets.map(ticketResponse);
  }

  async get(ticketId: string, branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "kds.read", branchId);
    const ticket = await this.prisma.preparationTicket.findFirst({
      where: {
        id: ticketId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: ticketListInclude,
    });
    if (!ticket) throw new NotFoundException("Preparation ticket not found.");
    return ticketResponse(ticket);
  }

  preparing(
    ticketId: string,
    input: TransitionPreparationTicketRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      ticketId,
      input,
      key,
      principal,
      PreparationTicketStatus.PREPARING,
    );
  }

  ready(
    ticketId: string,
    input: TransitionPreparationTicketRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      ticketId,
      input,
      key,
      principal,
      PreparationTicketStatus.READY,
    );
  }

  complete(
    ticketId: string,
    input: TransitionPreparationTicketRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      ticketId,
      input,
      key,
      principal,
      PreparationTicketStatus.COMPLETED,
    );
  }

  private async transition(
    ticketId: string,
    input: TransitionPreparationTicketRequest,
    key: string,
    principal: AuthPrincipal,
    target: PreparationTicketStatus,
  ) {
    this.permission(principal, "kds.write", input.branchId);
    const scope = `kds.tickets.${target.toLowerCase()}`;
    const command = { ticketId, ...input };
    const hashValue = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: { actorId: principal.userId, scope, key },
      },
    });
    if (existing) {
      if (existing.requestHash !== hashValue)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: "The idempotency key was used with a different command.",
        });
      return existing.responseBody;
    }

    return this.prisma.$transaction(
      async (tx) => {
        const ticket = await this.ticket(
          tx,
          ticketId,
          input.branchId,
          principal.organizationId,
        );
        if (ticket.revision !== input.revision)
          throw new ConflictException({
            code: "STALE_REVISION",
            message: "The ticket changed since it was read.",
          });
        if (!ticketTransitionAllowed(ticket.status, target))
          throw new ConflictException({
            code: "TICKET_STATE_INVALID",
            message: `The ticket cannot transition from ${ticket.status} to ${target}.`,
          });
        const at = new Date();
        const updated = await tx.preparationTicket.updateMany({
          where: {
            id: ticketId,
            revision: input.revision,
            status: ticket.status,
          },
          data: {
            status: target,
            revision: { increment: 1 },
            ...(target === "PREPARING" && { preparingAt: at }),
            ...(target === "READY" && { readyAt: at }),
            ...(target === "COMPLETED" && { completedAt: at }),
          },
        });
        if (updated.count !== 1)
          throw new ConflictException({
            code: "STALE_REVISION",
            message: "The ticket changed since it was read.",
          });
        const transitionEvent = await tx.preparationTicketEvent.create({
          data: {
            ticketId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            fromStatus: ticket.status,
            toStatus: target,
            revision: input.revision + 1,
            reason: input.reason,
          },
        });
        let inventory;
        if (target === PreparationTicketStatus.READY) {
          const candidateLineIds = [
            ...new Set(
              ticket.entries
                .filter(({ cancelledAt }) => cancelledAt === null)
                .map(({ orderLineId }) => orderLineId),
            ),
          ];
          const relatedEntries = await tx.preparationTicketEntry.findMany({
            where: {
              orderLineId: { in: candidateLineIds },
              cancelledAt: null,
            },
            select: { orderLineId: true, ticket: { select: { status: true } } },
          });
          const preparedLineIds = candidateLineIds.filter((orderLineId) =>
            relatedEntries
              .filter((entry) => entry.orderLineId === orderLineId)
              .every(
                (entry) =>
                  entry.ticket.status === PreparationTicketStatus.READY ||
                  entry.ticket.status === PreparationTicketStatus.COMPLETED,
              ),
          );
          inventory = await this.inventoryConsumption?.postAutomatically(
            tx,
            {
              branchId: input.branchId,
              orderLineIds: preparedLineIds,
              sourceEventId: transitionEvent.id,
              trigger: InventoryDeductionTrigger.PREPARED,
              occurredAt: transitionEvent.occurredAt,
              reason: input.reason,
            },
            principal,
          );
        }
        const response = await this.ticket(
          tx,
          ticketId,
          input.branchId,
          principal.organizationId,
        );
        const result = { ...response, inventory };
        await tx.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            branchId: input.branchId,
            actorId: principal.userId,
            action: scope,
            entityType: "preparation_ticket",
            entityId: ticketId,
            reason: input.reason,
            metadata: {
              deviceId: principal.deviceId,
              fromStatus: ticket.status,
              toStatus: target,
              revision: input.revision + 1,
            },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "preparation_ticket",
            aggregateId: ticketId,
            eventType: `preparation_ticket.${target.toLowerCase()}`,
            payload: {
              organizationId: principal.organizationId,
              branchId: input.branchId,
              ticketId,
              stationId: ticket.stationId,
              status: target,
            },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            actorId: principal.userId,
            scope,
            key,
            requestHash: hashValue,
            responseBody: json(result),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async branch(
    client: Tx | PrismaService,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    return branch;
  }

  private async ticket(
    client: Tx | PrismaService,
    ticketId: string,
    branchId: string,
    organizationId: string,
  ) {
    const ticket = await client.preparationTicket.findFirst({
      where: { id: ticketId, branchId, branch: { organizationId } },
      include: ticketInclude,
    });
    if (!ticket) throw new NotFoundException("Preparation ticket not found.");
    return ticket;
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
}
