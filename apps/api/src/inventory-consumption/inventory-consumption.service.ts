import type {
  ActivateInventoryConsumptionRoute,
  ActivateInventoryDeductionPolicy,
  ConfirmInventoryDeductionPolicy,
  CreateInventoryConsumptionRoute,
  CreateInventoryDeductionPolicy,
  InventoryConsumptionCommand,
  InventoryConsumptionListQuery,
  PostInventoryConsumption,
  ReverseInventoryConsumption,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InventoryDeductionTrigger,
  InventoryPolicyStatus,
  ModifierInventoryEffectKind,
  OrderEventType,
  PreparationTicketStatus,
  Prisma,
  RecipeStatus,
  StockLedgerType,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
type MutationResult = {
  entityId: string;
  eventType: string;
  reason: string;
  response: unknown;
};
type ResolvedEntry = {
  routeVersionId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  locationId: string;
  locationName: string;
  quantityMicros: bigint;
};
type ResolvedModifierEffect = {
  orderLineModifierId: string;
  effectVersionId: string;
  modifierQuantity: number;
};

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        jsonSafe(nested),
      ]),
    );
  }
  return value;
};
const asJson = (value: unknown) => jsonSafe(value) as Prisma.InputJsonObject;
const stripInternalActorIds = (value: unknown): unknown => {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripInternalActorIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) =>
            ![
              "createdById",
              "confirmedById",
              "activatedById",
              "actorId",
              "deviceId",
            ].includes(key),
        )
        .map(([key, nested]) => [key, stripInternalActorIds(nested)]),
    );
  }
  return value;
};
const stableUuid = (...parts: string[]) => {
  const bytes = createHash("sha256").update(parts.join("\u0000")).digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

@Injectable()
export class InventoryConsumptionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPolicies(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      stripInternalActorIds(
        await this.prisma.inventoryDeductionPolicyVersion.findMany({
          where: { branchId },
          include: {
            createdBy: { select: { displayName: true } },
            confirmedBy: { select: { displayName: true } },
            activatedBy: { select: { displayName: true } },
          },
          orderBy: [
            { effectiveFrom: "desc" },
            { createdAt: "desc" },
            { id: "asc" },
          ],
        }),
      ),
    );
  }

  async listRoutes(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      stripInternalActorIds(
        await this.prisma.inventoryConsumptionRouteVersion.findMany({
          where: { branchId },
          include: {
            inventoryItem: {
              select: { id: true, name: true, externalKey: true },
            },
            station: { select: { id: true, name: true } },
            location: { select: { id: true, name: true, externalKey: true } },
            createdBy: { select: { displayName: true } },
            activatedBy: { select: { displayName: true } },
          },
          orderBy: [
            { inventoryItemId: "asc" },
            { stationId: "asc" },
            { effectiveFrom: "desc" },
            { id: "asc" },
          ],
        }),
      ),
    );
  }

  async listConsumptions(
    branchId: string,
    query: InventoryConsumptionListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.inventoryConsumption.findMany({
      where: {
        branchId,
        ...(query.orderId ? { orderId: query.orderId } : {}),
        ...(query.orderLineId ? { orderLineId: query.orderLineId } : {}),
        ...(query.reversed === undefined
          ? {}
          : { reversal: query.reversed ? { isNot: null } : { is: null } }),
      },
      include: {
        entries: {
          include: {
            inventoryItem: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
            reversalEntry: true,
          },
          orderBy: [{ inventoryItemId: "asc" }, { locationId: "asc" }],
        },
        actor: { select: { displayName: true } },
        device: { select: { name: true } },
        reversal: { include: { entries: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
    });
    return jsonSafe(
      stripInternalActorIds(
        rows.map(({ entries, reversal, ...row }) => ({
          ...row,
          entries: entries.map(({ reversalEntry, ...entry }) => ({
            ...entry,
            reversed: Boolean(reversalEntry),
          })),
          reversed: Boolean(reversal),
        })),
      ),
    );
  }

  createPolicy(
    input: CreateInventoryDeductionPolicy,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-consumption.policy.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const policy = await tx.inventoryDeductionPolicyVersion.create({
          data: {
            id: input.policyVersionId,
            branchId: input.branchId,
            trigger: input.trigger,
            effectiveFrom: new Date(input.effectiveFrom),
            createdById: principal.userId,
          },
        });
        return this.result(
          policy.id,
          "inventory-consumption.policy.created",
          input.reason,
          policy,
        );
      },
    );
  }

  confirmPolicy(
    policyId: string,
    input: ConfirmInventoryDeductionPolicy,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.idempotent(
      "inventory-consumption.policy.confirm",
      key,
      { policyId, ...input },
      principal,
      async (tx) => {
        const policy = await this.policy(
          policyId,
          input.branchId,
          principal,
          tx,
        );
        this.revision(policy.revision, input.revision);
        if (policy.status !== InventoryPolicyStatus.DRAFT) {
          throw new ConflictException({ code: "INVENTORY_POLICY_NOT_DRAFT" });
        }
        const confirmed = await tx.inventoryDeductionPolicyVersion.update({
          where: { id: policy.id },
          data: {
            status: InventoryPolicyStatus.CONFIRMED,
            revision: { increment: 1 },
            evidenceReference: input.evidenceReference,
            confirmedById: principal.userId,
            confirmedAt: new Date(),
          },
        });
        return this.result(
          confirmed.id,
          "inventory-consumption.policy.confirmed",
          input.reason,
          confirmed,
        );
      },
    );
  }

  activatePolicy(
    policyId: string,
    input: ActivateInventoryDeductionPolicy,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.idempotent(
      "inventory-consumption.policy.activate",
      key,
      { policyId, ...input },
      principal,
      async (tx) => {
        const policy = await this.policy(
          policyId,
          input.branchId,
          principal,
          tx,
        );
        this.revision(policy.revision, input.revision);
        if (
          policy.status !== InventoryPolicyStatus.CONFIRMED ||
          !policy.evidenceReference ||
          !policy.confirmedAt
        ) {
          throw new ConflictException({
            code: "INVENTORY_POLICY_CONFIRMATION_REQUIRED",
          });
        }
        const activated = await tx.inventoryDeductionPolicyVersion.update({
          where: { id: policy.id },
          data: {
            status: InventoryPolicyStatus.ACTIVE,
            revision: { increment: 1 },
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
        });
        return this.result(
          activated.id,
          "inventory-consumption.policy.activated",
          input.reason,
          activated,
        );
      },
    );
  }

  createRoute(
    input: CreateInventoryConsumptionRoute,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-consumption.route.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.assertRouteTargets(tx, input, principal);
        const route = await tx.inventoryConsumptionRouteVersion.create({
          data: {
            id: input.routeVersionId,
            branchId: input.branchId,
            inventoryItemId: input.inventoryItemId,
            stationId: input.stationId ?? null,
            locationId: input.locationId,
            effectiveFrom: new Date(input.effectiveFrom),
            createdById: principal.userId,
          },
        });
        return this.result(
          route.id,
          "inventory-consumption.route.created",
          input.reason,
          route,
        );
      },
    );
  }

  activateRoute(
    routeId: string,
    input: ActivateInventoryConsumptionRoute,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-consumption.route.activate",
      key,
      { routeId, ...input },
      principal,
      async (tx) => {
        const route = await tx.inventoryConsumptionRouteVersion.findFirst({
          where: { id: routeId, branchId: input.branchId },
        });
        if (!route) throw new NotFoundException("Consumption route not found.");
        await this.branch(input.branchId, principal, tx);
        this.revision(route.revision, input.revision);
        if (route.status !== InventoryPolicyStatus.DRAFT) {
          throw new ConflictException({ code: "INVENTORY_ROUTE_NOT_DRAFT" });
        }
        await this.assertRouteTargets(tx, route, principal);
        const duplicate = await tx.inventoryConsumptionRouteVersion.findFirst({
          where: {
            branchId: route.branchId,
            inventoryItemId: route.inventoryItemId,
            stationId: route.stationId,
            effectiveFrom: route.effectiveFrom,
            status: InventoryPolicyStatus.ACTIVE,
            id: { not: route.id },
          },
        });
        if (duplicate) {
          throw new ConflictException({ code: "INVENTORY_ROUTE_AMBIGUOUS" });
        }
        const activated = await tx.inventoryConsumptionRouteVersion.update({
          where: { id: route.id },
          data: {
            status: InventoryPolicyStatus.ACTIVE,
            revision: { increment: 1 },
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
        });
        return this.result(
          activated.id,
          "inventory-consumption.route.activated",
          input.reason,
          activated,
        );
      },
    );
  }

  async postAutomatically(
    tx: Tx,
    input: {
      branchId: string;
      orderLineIds: readonly string[];
      sourceEventId: string;
      trigger: InventoryDeductionTrigger;
      occurredAt: Date;
      reason: string;
    },
    principal: AuthPrincipal,
  ) {
    const policy = await tx.inventoryDeductionPolicyVersion.findFirst({
      where: {
        branchId: input.branchId,
        status: InventoryPolicyStatus.ACTIVE,
        effectiveFrom: { lte: input.occurredAt },
      },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      include: {
        createdBy: { select: { displayName: true } },
        confirmedBy: { select: { displayName: true } },
        activatedBy: { select: { displayName: true } },
      },
    });
    if (!policy || policy.trigger !== input.trigger) {
      return { enabled: false, postedConsumptionIds: [] as string[] };
    }
    const existing = await tx.inventoryConsumption.findMany({
      where: { orderLineId: { in: [...input.orderLineIds] } },
      select: { orderLineId: true, id: true },
    });
    const existingByLine = new Map(
      existing.map((consumption) => [consumption.orderLineId, consumption.id]),
    );
    const postedConsumptionIds: string[] = [];
    for (const orderLineId of [...input.orderLineIds].sort()) {
      const replayed = existingByLine.get(orderLineId);
      if (replayed) {
        postedConsumptionIds.push(replayed);
        continue;
      }
      const resolved = await this.resolve(tx, {
        branchId: input.branchId,
        orderLineId,
        sourceEventId: input.sourceEventId,
        trigger: input.trigger,
      });
      for (const entry of resolved.entries) {
        await this.assertNonNegative(
          tx,
          input.branchId,
          entry.locationId,
          entry.inventoryItemId,
          -entry.quantityMicros,
          false,
        );
      }
      const consumptionId = stableUuid(
        "inventory-consumption",
        input.trigger,
        input.sourceEventId,
        orderLineId,
      );
      await tx.inventoryConsumption.create({
        data: {
          id: consumptionId,
          branchId: input.branchId,
          orderId: resolved.orderId,
          orderLineId,
          policyVersionId: resolved.policyVersionId,
          recipeVersionId: resolved.recipeVersionId,
          actorId: principal.userId,
          deviceId: principal.deviceId,
          sourceEventId: input.sourceEventId,
          trigger: input.trigger,
          orderLineQuantity: resolved.orderLineQuantity,
          occurredAt: resolved.occurredAt,
          reason: input.reason,
        },
      });
      if (resolved.modifierEffects.length) {
        await tx.inventoryConsumptionModifierEffect.createMany({
          data: resolved.modifierEffects.map((effect) => ({
            consumptionId,
            orderLineModifierId: effect.orderLineModifierId,
            effectVersionId: effect.effectVersionId,
            modifierQuantity: effect.modifierQuantity,
          })),
        });
      }
      for (const entry of resolved.entries) {
        const ledgerEntryId = stableUuid(
          "inventory-consumption-ledger",
          consumptionId,
          entry.inventoryItemId,
          entry.locationId,
        );
        await tx.stockLedgerEntry.create({
          data: {
            id: ledgerEntryId,
            branchId: input.branchId,
            locationId: entry.locationId,
            inventoryItemId: entry.inventoryItemId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: StockLedgerType.SALE_CONSUMPTION,
            quantityDeltaMicros: -entry.quantityMicros,
            sourceType: "INVENTORY_CONSUMPTION",
            sourceId: consumptionId,
            reason: input.reason,
            occurredAt: resolved.occurredAt,
          },
        });
        await tx.inventoryConsumptionEntry.create({
          data: {
            id: stableUuid(
              "inventory-consumption-entry",
              consumptionId,
              entry.inventoryItemId,
              entry.locationId,
            ),
            consumptionId,
            routeVersionId: entry.routeVersionId,
            inventoryItemId: entry.inventoryItemId,
            locationId: entry.locationId,
            quantityMicros: entry.quantityMicros,
            ledgerEntryId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          branchId: input.branchId,
          actorId: principal.userId,
          action: "inventory-consumption.automatic.post",
          entityType: "inventory-consumption",
          entityId: consumptionId,
          reason: input.reason,
          metadata: {
            deviceId: principal.deviceId,
            trigger: input.trigger,
            sourceEventId: input.sourceEventId,
            orderLineId,
          },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "inventory-consumption",
          aggregateId: consumptionId,
          eventType: "inventory-consumption.automatically-posted",
          payload: {
            organizationId: principal.organizationId,
            branchId: input.branchId,
            consumptionId,
            orderLineId,
            trigger: input.trigger,
          },
        },
      });
      postedConsumptionIds.push(consumptionId);
    }
    return { enabled: true, postedConsumptionIds };
  }

  async reverseAutomatically(
    tx: Tx,
    input: {
      branchId: string;
      orderLineId: string;
      cancellationId: string;
      reason: string;
      occurredAt: Date;
    },
    principal: AuthPrincipal,
  ) {
    const consumption = await tx.inventoryConsumption.findUnique({
      where: { orderLineId: input.orderLineId },
      include: { entries: true, reversal: true },
    });
    if (!consumption || consumption.branchId !== input.branchId) {
      return { reversed: false, reversalId: null };
    }
    if (consumption.reversal) {
      return { reversed: true, reversalId: consumption.reversal.id };
    }
    const reversalId = stableUuid(
      "inventory-consumption-reversal",
      input.cancellationId,
      consumption.id,
    );
    await tx.inventoryConsumptionReversal.create({
      data: {
        id: reversalId,
        branchId: input.branchId,
        consumptionId: consumption.id,
        actorId: principal.userId,
        deviceId: principal.deviceId,
        reason: input.reason,
        createdAt: input.occurredAt,
      },
    });
    for (const entry of consumption.entries) {
      const ledgerEntryId = stableUuid(
        "inventory-consumption-reversal-ledger",
        reversalId,
        entry.id,
      );
      await tx.stockLedgerEntry.create({
        data: {
          id: ledgerEntryId,
          branchId: input.branchId,
          locationId: entry.locationId,
          inventoryItemId: entry.inventoryItemId,
          actorId: principal.userId,
          deviceId: principal.deviceId,
          type: StockLedgerType.REVERSAL,
          quantityDeltaMicros: entry.quantityMicros,
          sourceType: "INVENTORY_CONSUMPTION_REVERSAL",
          sourceId: reversalId,
          reason: input.reason,
          occurredAt: input.occurredAt,
        },
      });
      await tx.inventoryConsumptionReversalEntry.create({
        data: {
          id: stableUuid(
            "inventory-consumption-reversal-entry",
            reversalId,
            entry.id,
          ),
          reversalId,
          consumptionEntryId: entry.id,
          ledgerEntryId,
        },
      });
    }
    await tx.inventoryConsumption.update({
      where: { id: consumption.id },
      data: { revision: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        branchId: input.branchId,
        actorId: principal.userId,
        action: "inventory-consumption.automatic.reverse",
        entityType: "inventory-consumption-reversal",
        entityId: reversalId,
        reason: input.reason,
        metadata: {
          deviceId: principal.deviceId,
          consumptionId: consumption.id,
          cancellationId: input.cancellationId,
        },
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "inventory-consumption",
        aggregateId: consumption.id,
        eventType: "inventory-consumption.automatically-reversed",
        payload: {
          organizationId: principal.organizationId,
          branchId: input.branchId,
          consumptionId: consumption.id,
          reversalId,
          orderLineId: input.orderLineId,
        },
      },
    });
    return { reversed: true, reversalId };
  }

  async preview(input: InventoryConsumptionCommand, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", input.branchId);
    await this.branch(input.branchId, principal);
    return jsonSafe(await this.resolve(this.prisma, input));
  }

  post(input: PostInventoryConsumption, key: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.write", input.branchId);
    if (input.allowNegativeOverride) {
      this.permission(principal, "inventory.manage", input.branchId);
    }
    return this.idempotent(
      "inventory-consumption.post",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const resolved = await this.resolve(tx, input);
        const ledgerIds = this.matchPostLedgerEntries(
          resolved.entries,
          input.ledgerEntries,
        );
        for (const entry of resolved.entries) {
          await this.assertNonNegative(
            tx,
            input.branchId,
            entry.locationId,
            entry.inventoryItemId,
            -entry.quantityMicros,
            input.allowNegativeOverride,
          );
        }
        const consumption = await tx.inventoryConsumption.create({
          data: {
            id: input.consumptionId,
            branchId: input.branchId,
            orderId: resolved.orderId,
            orderLineId: input.orderLineId,
            policyVersionId: resolved.policyVersionId,
            recipeVersionId: resolved.recipeVersionId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            sourceEventId: input.sourceEventId,
            trigger: input.trigger,
            orderLineQuantity: resolved.orderLineQuantity,
            occurredAt: resolved.occurredAt,
            reason: input.reason,
            negativeStockOverride: input.allowNegativeOverride,
          },
        });
        if (resolved.modifierEffects.length) {
          await tx.inventoryConsumptionModifierEffect.createMany({
            data: resolved.modifierEffects.map((effect) => ({
              consumptionId: consumption.id,
              orderLineModifierId: effect.orderLineModifierId,
              effectVersionId: effect.effectVersionId,
              modifierQuantity: effect.modifierQuantity,
            })),
          });
        }
        for (const entry of resolved.entries) {
          const ledgerEntryId = ledgerIds.get(
            `${entry.inventoryItemId}:${entry.locationId}`,
          );
          if (!ledgerEntryId) {
            throw new ConflictException({
              code: "INVENTORY_LEDGER_MAPPING_INVALID",
            });
          }
          await tx.stockLedgerEntry.create({
            data: {
              id: ledgerEntryId,
              branchId: input.branchId,
              locationId: entry.locationId,
              inventoryItemId: entry.inventoryItemId,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              type: StockLedgerType.SALE_CONSUMPTION,
              quantityDeltaMicros: -entry.quantityMicros,
              sourceType: "INVENTORY_CONSUMPTION",
              sourceId: consumption.id,
              negativeStockOverride: input.allowNegativeOverride,
              reason: input.reason,
              occurredAt: resolved.occurredAt,
            },
          });
          await tx.inventoryConsumptionEntry.create({
            data: {
              id: randomUUID(),
              consumptionId: consumption.id,
              routeVersionId: entry.routeVersionId,
              inventoryItemId: entry.inventoryItemId,
              locationId: entry.locationId,
              quantityMicros: entry.quantityMicros,
              ledgerEntryId,
            },
          });
        }
        const posted = await tx.inventoryConsumption.findUniqueOrThrow({
          where: { id: consumption.id },
          include: { entries: true, modifierEffects: true },
        });
        return this.result(
          posted.id,
          "inventory-consumption.posted",
          input.reason,
          jsonSafe(posted),
        );
      },
    );
  }

  reverse(
    consumptionId: string,
    input: ReverseInventoryConsumption,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.idempotent(
      "inventory-consumption.reverse",
      key,
      { consumptionId, ...input },
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const consumption = await tx.inventoryConsumption.findFirst({
          where: { id: consumptionId, branchId: input.branchId },
          include: { entries: true, reversal: true },
        });
        if (!consumption) throw new NotFoundException("Consumption not found.");
        this.revision(consumption.revision, input.consumptionRevision);
        if (consumption.reversal) {
          throw new ConflictException({
            code: "INVENTORY_CONSUMPTION_REVERSED",
          });
        }
        const ledgerIds = this.matchReversalLedgerEntries(
          consumption.entries,
          input.ledgerEntries,
        );
        const reversal = await tx.inventoryConsumptionReversal.create({
          data: {
            id: input.reversalId,
            branchId: input.branchId,
            consumptionId: consumption.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
          },
        });
        for (const entry of consumption.entries) {
          const ledgerEntryId = ledgerIds.get(entry.id);
          if (!ledgerEntryId) {
            throw new ConflictException({
              code: "INVENTORY_LEDGER_MAPPING_INVALID",
            });
          }
          await tx.stockLedgerEntry.create({
            data: {
              id: ledgerEntryId,
              branchId: input.branchId,
              locationId: entry.locationId,
              inventoryItemId: entry.inventoryItemId,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              type: StockLedgerType.REVERSAL,
              quantityDeltaMicros: entry.quantityMicros,
              sourceType: "INVENTORY_CONSUMPTION_REVERSAL",
              sourceId: reversal.id,
              reason: input.reason,
              occurredAt: new Date(),
            },
          });
          await tx.inventoryConsumptionReversalEntry.create({
            data: {
              id: randomUUID(),
              reversalId: reversal.id,
              consumptionEntryId: entry.id,
              ledgerEntryId,
            },
          });
        }
        await tx.inventoryConsumption.update({
          where: { id: consumption.id },
          data: { revision: { increment: 1 } },
        });
        const posted = await tx.inventoryConsumptionReversal.findUniqueOrThrow({
          where: { id: reversal.id },
          include: { entries: true },
        });
        return this.result(
          posted.id,
          "inventory-consumption.reversed",
          input.reason,
          jsonSafe(posted),
        );
      },
    );
  }

  async reconciliation(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    const now = new Date();
    const policy = await this.prisma.inventoryDeductionPolicyVersion.findFirst({
      where: {
        branchId,
        status: InventoryPolicyStatus.ACTIVE,
        effectiveFrom: { lte: now },
      },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    const [sentUnconsumed, cancelledConsumed, totalPosted, totalReversed] =
      await Promise.all([
        this.prisma.orderLine.count({
          where: {
            order: { branchId },
            sentAt: { not: null },
            sentCancelledAt: null,
            inventoryConsumption: null,
          },
        }),
        this.prisma.inventoryConsumption.count({
          where: {
            branchId,
            orderLine: { sentCancelledAt: { not: null } },
            reversal: null,
          },
        }),
        this.prisma.inventoryConsumption.count({ where: { branchId } }),
        this.prisma.inventoryConsumptionReversal.count({ where: { branchId } }),
      ]);
    return {
      generatedAt: now.toISOString(),
      branchId,
      postingCommandEnabled: Boolean(policy),
      automaticEventDispatchEnabled: false,
      activePolicy: jsonSafe(stripInternalActorIds(policy)),
      configurationIssue: policy ? null : "INVENTORY_DEDUCTION_POLICY_MISSING",
      counts: {
        sentLinesWithoutConsumption: sentUnconsumed,
        cancelledConsumedLinesWithoutReversal: cancelledConsumed,
        postedConsumptions: totalPosted,
        postedReversals: totalReversed,
      },
    };
  }

  private async resolve(db: Db, input: InventoryConsumptionCommand) {
    const line = await db.orderLine.findFirst({
      where: { id: input.orderLineId, order: { branchId: input.branchId } },
      include: {
        order: { select: { id: true, branchId: true } },
        modifiers: {
          select: { id: true, menuModifierId: true, quantity: true },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!line) throw new NotFoundException("Order line not found.");
    if (line.sentCancelledAt) {
      throw new ConflictException({ code: "ORDER_LINE_SENT_CANCELLED" });
    }
    const occurredAt = await this.sourceOccurredAt(db, line, input);
    if (line.modifiers.length > 0) {
      return this.resolveWithModifiers(db, input, line, occurredAt);
    }
    const policy = await db.inventoryDeductionPolicyVersion.findFirst({
      where: {
        branchId: input.branchId,
        status: InventoryPolicyStatus.ACTIVE,
        effectiveFrom: { lte: occurredAt },
      },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    if (!policy) {
      throw new ConflictException({
        code: "INVENTORY_DEDUCTION_POLICY_MISSING",
      });
    }
    if (policy.trigger !== input.trigger) {
      throw new ConflictException({
        code: "INVENTORY_DEDUCTION_TRIGGER_MISMATCH",
        configuredTrigger: policy.trigger,
      });
    }
    const recipe = await db.recipeVersion.findFirst({
      where: {
        branchId: input.branchId,
        menuItemId: line.menuItemId,
        menuVariantId: line.variantId ?? null,
        status: RecipeStatus.ACTIVE,
        effectiveFrom: { lte: occurredAt },
      },
      include: {
        components: {
          include: {
            inventoryItem: { select: { id: true, name: true, isActive: true } },
          },
          orderBy: { inventoryItemId: "asc" },
        },
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }, { id: "desc" }],
    });
    if (!recipe || recipe.components.length === 0) {
      throw new ConflictException({ code: "RECIPE_CONFIGURATION_MISSING" });
    }
    if (recipe.yieldQuantityMicros <= 0n) {
      throw new ConflictException({ code: "RECIPE_YIELD_INVALID" });
    }
    const entries: ResolvedEntry[] = [];
    for (const component of recipe.components) {
      if (!component.inventoryItem.isActive) {
        throw new ConflictException({
          code: "INVENTORY_RECIPE_ITEM_UNAVAILABLE",
        });
      }
      const numerator =
        component.quantityMicros * BigInt(line.quantity) * 1_000_000n;
      if (numerator % recipe.yieldQuantityMicros !== 0n) {
        throw new ConflictException({
          code: "INVENTORY_CONSUMPTION_FRACTIONAL_MICRO",
          inventoryItemId: component.inventoryItemId,
        });
      }
      const quantityMicros = numerator / recipe.yieldQuantityMicros;
      if (quantityMicros <= 0n) {
        throw new ConflictException({ code: "INVENTORY_CONSUMPTION_INVALID" });
      }
      const routes = await db.inventoryConsumptionRouteVersion.findMany({
        where: {
          branchId: input.branchId,
          inventoryItemId: component.inventoryItemId,
          status: InventoryPolicyStatus.ACTIVE,
          effectiveFrom: { lte: occurredAt },
          OR: [{ stationId: line.stationId }, { stationId: null }],
        },
        include: {
          location: { select: { id: true, name: true, isActive: true } },
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      });
      const route =
        routes.find((candidate) => candidate.stationId === line.stationId) ??
        routes.find((candidate) => candidate.stationId === null);
      if (!route) {
        throw new ConflictException({
          code: "INVENTORY_CONSUMPTION_ROUTE_MISSING",
          inventoryItemId: component.inventoryItemId,
          stationId: line.stationId,
        });
      }
      if (!route.location.isActive) {
        throw new ConflictException({
          code: "INVENTORY_CONSUMPTION_LOCATION_UNAVAILABLE",
          locationId: route.locationId,
        });
      }
      entries.push({
        routeVersionId: route.id,
        inventoryItemId: component.inventoryItemId,
        inventoryItemName: component.inventoryItem.name,
        locationId: route.locationId,
        locationName: route.location.name,
        quantityMicros,
      });
    }
    return {
      configured: true,
      orderId: line.orderId,
      orderLineId: line.id,
      orderLineQuantity: line.quantity,
      trigger: input.trigger,
      occurredAt,
      policyVersionId: policy.id,
      recipeVersionId: recipe.id,
      recipeVersion: recipe.version,
      entries,
      modifierEffects: [] as ResolvedModifierEffect[],
    };
  }

  private async resolveWithModifiers(
    db: Db,
    input: InventoryConsumptionCommand,
    line: {
      id: string;
      orderId: string;
      menuItemId: string;
      variantId: string | null;
      stationId: string | null;
      quantity: number;
      modifiers: Array<{
        id: string;
        menuModifierId: string;
        quantity: number;
      }>;
    },
    occurredAt: Date,
  ) {
    const [policy, recipe, versions] = await Promise.all([
      db.inventoryDeductionPolicyVersion.findFirst({
        where: {
          branchId: input.branchId,
          status: InventoryPolicyStatus.ACTIVE,
          effectiveFrom: { lte: occurredAt },
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      }),
      db.recipeVersion.findFirst({
        where: {
          branchId: input.branchId,
          menuItemId: line.menuItemId,
          menuVariantId: line.variantId,
          status: RecipeStatus.ACTIVE,
          effectiveFrom: { lte: occurredAt },
        },
        include: {
          components: {
            include: {
              inventoryItem: {
                select: { id: true, name: true, isActive: true },
              },
            },
            orderBy: { inventoryItemId: "asc" },
          },
        },
        orderBy: [
          { effectiveFrom: "desc" },
          { version: "desc" },
          { id: "desc" },
        ],
      }),
      db.modifierRecipeEffectVersion.findMany({
        where: {
          branchId: input.branchId,
          menuModifierId: {
            in: line.modifiers.map((modifier) => modifier.menuModifierId),
          },
          status: RecipeStatus.ACTIVE,
          effectiveFrom: { lte: occurredAt },
        },
        include: {
          components: {
            include: {
              inventoryItem: {
                select: { id: true, name: true, isActive: true },
              },
            },
            orderBy: [{ inventoryItemId: "asc" }, { kind: "asc" }],
          },
        },
        orderBy: [
          { menuModifierId: "asc" },
          { effectiveFrom: "desc" },
          { version: "desc" },
          { id: "desc" },
        ],
      }),
    ]);
    if (!policy) {
      throw new ConflictException({
        code: "INVENTORY_DEDUCTION_POLICY_MISSING",
      });
    }
    if (policy.trigger !== input.trigger) {
      throw new ConflictException({
        code: "INVENTORY_DEDUCTION_TRIGGER_MISMATCH",
        configuredTrigger: policy.trigger,
      });
    }
    if (!recipe || recipe.components.length === 0) {
      throw new ConflictException({ code: "RECIPE_CONFIGURATION_MISSING" });
    }
    if (recipe.yieldQuantityMicros <= 0n) {
      throw new ConflictException({ code: "RECIPE_YIELD_INVALID" });
    }
    const selected = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!selected.has(version.menuModifierId)) {
        selected.set(version.menuModifierId, version);
      }
    }
    const quantities = new Map<
      string,
      { quantityMicros: bigint; name: string }
    >();
    for (const component of recipe.components) {
      if (!component.inventoryItem.isActive) {
        throw new ConflictException({
          code: "INVENTORY_RECIPE_ITEM_UNAVAILABLE",
        });
      }
      const numerator =
        component.quantityMicros * BigInt(line.quantity) * 1_000_000n;
      if (numerator % recipe.yieldQuantityMicros !== 0n) {
        throw new ConflictException({
          code: "INVENTORY_CONSUMPTION_FRACTIONAL_MICRO",
          inventoryItemId: component.inventoryItemId,
        });
      }
      quantities.set(component.inventoryItemId, {
        quantityMicros: numerator / recipe.yieldQuantityMicros,
        name: component.inventoryItem.name,
      });
    }
    const modifierEffects: ResolvedModifierEffect[] = [];
    for (const modifier of line.modifiers) {
      const effect = selected.get(modifier.menuModifierId);
      if (!effect) {
        throw new ConflictException({
          code: "MODIFIER_INVENTORY_POLICY_UNCONFIRMED",
          menuModifierId: modifier.menuModifierId,
        });
      }
      if (effect.affectsInventory !== effect.components.length > 0) {
        throw new ConflictException({
          code: "MODIFIER_INVENTORY_EFFECT_INVALID",
          effectVersionId: effect.id,
        });
      }
      modifierEffects.push({
        orderLineModifierId: modifier.id,
        effectVersionId: effect.id,
        modifierQuantity: modifier.quantity,
      });
      for (const component of effect.components) {
        if (!component.inventoryItem.isActive) {
          throw new ConflictException({
            code: "INVENTORY_RECIPE_ITEM_UNAVAILABLE",
          });
        }
        const removes =
          component.kind === ModifierInventoryEffectKind.REMOVE ||
          component.kind === ModifierInventoryEffectKind.REPLACE_REMOVE;
        const delta =
          component.quantityMicros *
          BigInt(line.quantity) *
          BigInt(modifier.quantity) *
          (removes ? -1n : 1n);
        const current = quantities.get(component.inventoryItemId);
        quantities.set(component.inventoryItemId, {
          quantityMicros: (current?.quantityMicros ?? 0n) + delta,
          name: current?.name ?? component.inventoryItem.name,
        });
      }
    }
    const required = [...quantities.entries()]
      .filter(([, value]) => value.quantityMicros !== 0n)
      .sort(([left], [right]) => left.localeCompare(right));
    const invalid = required.find(([, value]) => value.quantityMicros < 0n);
    if (invalid) {
      throw new ConflictException({
        code: "MODIFIER_INVENTORY_EFFECT_NEGATIVE",
        inventoryItemId: invalid[0],
      });
    }
    if (required.length === 0) {
      throw new ConflictException({ code: "INVENTORY_CONSUMPTION_EMPTY" });
    }
    const routes = await db.inventoryConsumptionRouteVersion.findMany({
      where: {
        branchId: input.branchId,
        inventoryItemId: { in: required.map(([itemId]) => itemId) },
        status: InventoryPolicyStatus.ACTIVE,
        effectiveFrom: { lte: occurredAt },
        OR: [{ stationId: line.stationId }, { stationId: null }],
      },
      include: {
        location: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: [
        { inventoryItemId: "asc" },
        { effectiveFrom: "desc" },
        { id: "desc" },
      ],
    });
    const entries: ResolvedEntry[] = required.map(
      ([inventoryItemId, requiredItem]) => {
        const candidates = routes.filter(
          (route) => route.inventoryItemId === inventoryItemId,
        );
        const route =
          candidates.find(
            (candidate) => candidate.stationId === line.stationId,
          ) ?? candidates.find((candidate) => candidate.stationId === null);
        if (!route) {
          throw new ConflictException({
            code: "INVENTORY_CONSUMPTION_ROUTE_MISSING",
            inventoryItemId,
            stationId: line.stationId,
          });
        }
        if (!route.location.isActive) {
          throw new ConflictException({
            code: "INVENTORY_CONSUMPTION_LOCATION_UNAVAILABLE",
            locationId: route.locationId,
          });
        }
        return {
          routeVersionId: route.id,
          inventoryItemId,
          inventoryItemName: requiredItem.name,
          locationId: route.locationId,
          locationName: route.location.name,
          quantityMicros: requiredItem.quantityMicros,
        };
      },
    );
    return {
      configured: true,
      orderId: line.orderId,
      orderLineId: line.id,
      orderLineQuantity: line.quantity,
      trigger: input.trigger,
      occurredAt,
      policyVersionId: policy.id,
      recipeVersionId: recipe.id,
      recipeVersion: recipe.version,
      entries,
      modifierEffects,
    };
  }

  private async sourceOccurredAt(
    db: Db,
    line: {
      id: string;
      orderId: string;
      sendWaveId: string | null;
      sentAt: Date | null;
    },
    input: InventoryConsumptionCommand,
  ) {
    if (input.trigger === InventoryDeductionTrigger.SENT) {
      if (line.sendWaveId !== input.sourceEventId || !line.sentAt) {
        throw new ConflictException({ code: "INVENTORY_SOURCE_EVENT_INVALID" });
      }
      return line.sentAt;
    }
    if (input.trigger === InventoryDeductionTrigger.PREPARED) {
      const event = await db.preparationTicketEvent.findFirst({
        where: {
          id: input.sourceEventId,
          toStatus: PreparationTicketStatus.READY,
          ticket: {
            entries: { some: { orderLineId: line.id, cancelledAt: null } },
          },
        },
      });
      if (!event) {
        throw new ConflictException({ code: "INVENTORY_SOURCE_EVENT_INVALID" });
      }
      return event.occurredAt;
    }
    if (input.trigger === InventoryDeductionTrigger.COMPLETED) {
      const event = await db.orderEvent.findFirst({
        where: {
          id: input.sourceEventId,
          type: OrderEventType.COMPLETED,
          OR: [
            { orderId: line.orderId },
            {
              order: {
                mergesAsTarget: { some: { sourceOrderId: line.orderId } },
              },
            },
          ],
        },
      });
      if (!event) {
        throw new ConflictException({ code: "INVENTORY_SOURCE_EVENT_INVALID" });
      }
      return event.occurredAt;
    }
    throw new ConflictException({
      code: "INVENTORY_SOURCE_EVENT_UNAVAILABLE",
      trigger: input.trigger,
    });
  }

  private matchPostLedgerEntries(
    resolved: ResolvedEntry[],
    provided: PostInventoryConsumption["ledgerEntries"],
  ) {
    const map = new Map<string, string>();
    for (const entry of provided) {
      const key = `${entry.inventoryItemId}:${entry.locationId}`;
      if (map.has(key)) {
        throw new ConflictException({
          code: "INVENTORY_LEDGER_MAPPING_INVALID",
        });
      }
      map.set(key, entry.ledgerEntryId);
    }
    if (
      map.size !== resolved.length ||
      resolved.some(
        (entry) => !map.has(`${entry.inventoryItemId}:${entry.locationId}`),
      )
    ) {
      throw new ConflictException({ code: "INVENTORY_LEDGER_MAPPING_INVALID" });
    }
    return map;
  }

  private matchReversalLedgerEntries(
    resolved: Array<{ id: string }>,
    provided: ReverseInventoryConsumption["ledgerEntries"],
  ) {
    const map = new Map<string, string>();
    for (const entry of provided) {
      if (map.has(entry.consumptionEntryId)) {
        throw new ConflictException({
          code: "INVENTORY_LEDGER_MAPPING_INVALID",
        });
      }
      map.set(entry.consumptionEntryId, entry.ledgerEntryId);
    }
    if (
      map.size !== resolved.length ||
      resolved.some((entry) => !map.has(entry.id))
    ) {
      throw new ConflictException({ code: "INVENTORY_LEDGER_MAPPING_INVALID" });
    }
    return map;
  }

  private async assertRouteTargets(
    tx: Tx,
    input: {
      branchId: string;
      inventoryItemId: string;
      stationId?: string | null;
      locationId: string;
    },
    principal: AuthPrincipal,
  ) {
    await this.branch(input.branchId, principal, tx);
    const [item, location, station] = await Promise.all([
      tx.inventoryItem.findFirst({
        where: {
          id: input.inventoryItemId,
          branchId: input.branchId,
          isActive: true,
        },
      }),
      tx.stockLocation.findFirst({
        where: {
          id: input.locationId,
          branchId: input.branchId,
          isActive: true,
        },
      }),
      input.stationId
        ? tx.station.findFirst({
            where: {
              id: input.stationId,
              branchId: input.branchId,
              isActive: true,
            },
          })
        : Promise.resolve(true),
    ]);
    if (!item || !location || !station) {
      throw new ConflictException({ code: "INVENTORY_ROUTE_TARGET_INVALID" });
    }
  }

  private async assertNonNegative(
    tx: Tx,
    branchId: string,
    locationId: string,
    itemId: string,
    delta: bigint,
    override: boolean,
  ) {
    const aggregate = await tx.stockLedgerEntry.aggregate({
      where: { branchId, locationId, inventoryItemId: itemId },
      _sum: { quantityDeltaMicros: true },
    });
    if ((aggregate._sum.quantityDeltaMicros ?? 0n) + delta >= 0n) return;
    if (!override) {
      throw new ConflictException({
        code: "NEGATIVE_STOCK_POLICY_UNCONFIRMED",
      });
    }
  }

  private async policy(
    policyId: string,
    branchId: string,
    principal: AuthPrincipal,
    tx: Tx,
  ) {
    await this.branch(branchId, principal, tx);
    const policy = await tx.inventoryDeductionPolicyVersion.findFirst({
      where: { id: policyId, branchId },
    });
    if (!policy) throw new NotFoundException("Deduction policy not found.");
    return policy;
  }

  private revision(current: number, supplied: number) {
    if (current !== supplied) {
      throw new ConflictException({ code: "STALE_REVISION" });
    }
  }

  private async branch(
    branchId: string,
    principal: AuthPrincipal,
    db: Db = this.prisma,
  ) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, organizationId: principal.organizationId },
      select: { id: true, organizationId: true },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    return branch;
  }

  private permission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId)) {
      throw new ForbiddenException("Permission denied for branch.");
    }
  }

  private result(
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
  ): MutationResult {
    return {
      entityId,
      eventType,
      reason,
      response: stripInternalActorIds(response),
    };
  }

  private async idempotent(
    scope: string,
    key: string,
    command: { branchId: string } & Record<string, unknown>,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<MutationResult>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      }
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
              entityType: "inventory-consumption",
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
              aggregateType: "inventory-consumption",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: command.branchId,
                inventoryConsumptionEntityId: result.entityId,
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
        throw new ConflictException({ code: "INVENTORY_CONSUMPTION_CONFLICT" });
      }
      throw error;
    }
  }
}
