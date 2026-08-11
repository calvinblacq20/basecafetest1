import type {
  AvailabilityHistoryQuery,
  AvailabilityPreview,
  ConfirmCriticalIngredientRule,
  CreateCriticalIngredientRule,
  CriticalIngredientRuleRevision,
  RecordManualAvailability,
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
  AvailabilityTargetKind,
  InventoryPolicyStatus,
  ManualAvailabilityState,
  Prisma,
  RecipeStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
type MutationResult = {
  branchId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  reason: string;
  response: unknown;
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

function targetKey(
  kind: AvailabilityTargetKind,
  ids: {
    menuItemId?: string;
    menuVariantId?: string;
    menuModifierId?: string;
  },
) {
  if (kind === AvailabilityTargetKind.ITEM) return `ITEM:${ids.menuItemId}`;
  if (kind === AvailabilityTargetKind.VARIANT)
    return `VARIANT:${ids.menuVariantId}`;
  return `MODIFIER:${ids.menuModifierId}`;
}

@Injectable()
export class InventoryAvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listRules(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(this.prisma, branchId, principal.organizationId);
    return jsonSafe(
      stripInternalActorIds(
        await this.prisma.criticalIngredientRuleVersion.findMany({
          where: { branchId },
          include: {
            menuItem: { select: { id: true, name: true } },
            menuVariant: { select: { id: true, name: true } },
            recipeVersion: { select: { id: true, version: true } },
            createdBy: { select: { displayName: true } },
            confirmedBy: { select: { displayName: true } },
            activatedBy: { select: { displayName: true } },
            components: {
              include: {
                inventoryItem: { select: { id: true, name: true } },
                locations: {
                  include: { location: { select: { id: true, name: true } } },
                  orderBy: { locationId: "asc" },
                },
              },
              orderBy: { inventoryItemId: "asc" },
            },
          },
          orderBy: [
            { menuItemId: "asc" },
            { menuVariantId: "asc" },
            { version: "desc" },
          ],
        }),
      ),
    );
  }

  async listManualHistory(
    branchId: string,
    query: AvailabilityHistoryQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "catalog.availability.read", branchId);
    await this.branch(this.prisma, branchId, principal.organizationId);
    return jsonSafe(
      stripInternalActorIds(
        await this.prisma.manualAvailabilityEvent.findMany({
          where: {
            branchId,
            ...(query.targetKind ? { targetKind: query.targetKind } : {}),
            ...(query.menuItemId ? { menuItemId: query.menuItemId } : {}),
            ...(query.menuVariantId
              ? { menuVariantId: query.menuVariantId }
              : {}),
            ...(query.menuModifierId
              ? { menuModifierId: query.menuModifierId }
              : {}),
          },
          include: {
            actor: { select: { displayName: true } },
            device: { select: { name: true } },
          },
          orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          take: query.limit,
        }),
      ),
    );
  }

  async preview(input: AvailabilityPreview, principal: AuthPrincipal) {
    this.permission(principal, "catalog.availability.read", input.branchId);
    await this.branch(this.prisma, input.branchId, principal.organizationId);
    return jsonSafe(await this.resolve(this.prisma, input));
  }

  createRule(
    input: CreateCriticalIngredientRule,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-availability.rule.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(tx, input.branchId, principal.organizationId);
        const effectiveFrom = new Date(input.effectiveFrom);
        const item = await tx.menuItem.findFirst({
          where: { id: input.menuItemId, branchId: input.branchId },
          include: { variants: { select: { id: true } } },
        });
        if (!item) throw new NotFoundException("Menu item not found.");
        if (
          input.menuVariantId &&
          !item.variants.some(({ id }) => id === input.menuVariantId)
        ) {
          throw new ConflictException({ code: "AVAILABILITY_TARGET_INVALID" });
        }
        const recipe = await tx.recipeVersion.findFirst({
          where: {
            id: input.recipeVersionId,
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
            status: RecipeStatus.ACTIVE,
            effectiveFrom: { lte: effectiveFrom },
          },
          include: { components: true },
        });
        if (!recipe) {
          throw new ConflictException({
            code: "AVAILABILITY_RECIPE_CONFIGURATION_MISSING",
          });
        }
        const recipeItems = new Set(
          recipe.components.map(({ inventoryItemId }) => inventoryItemId),
        );
        if (
          input.components.some(
            ({ inventoryItemId }) => !recipeItems.has(inventoryItemId),
          )
        ) {
          throw new ConflictException({
            code: "CRITICAL_INGREDIENT_NOT_IN_RECIPE",
          });
        }
        const locationIds = [
          ...new Set(
            input.components.flatMap(({ locationIds }) => locationIds),
          ),
        ];
        const locations = await tx.stockLocation.count({
          where: {
            branchId: input.branchId,
            id: { in: locationIds },
            isActive: true,
          },
        });
        if (locations !== locationIds.length) {
          throw new ConflictException({ code: "STOCK_LOCATION_UNAVAILABLE" });
        }
        const latest = await tx.criticalIngredientRuleVersion.findFirst({
          where: {
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
          },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const rule = await tx.criticalIngredientRuleVersion.create({
          data: {
            id: input.ruleVersionId,
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
            recipeVersionId: recipe.id,
            version: (latest?.version ?? 0) + 1,
            effectiveFrom,
            createdById: principal.userId,
            components: {
              create: input.components.map((component) => ({
                branchId: input.branchId,
                inventoryItemId: component.inventoryItemId,
                safetyStockMicros: BigInt(component.safetyStockMicros),
                locations: {
                  create: component.locationIds.map((locationId) => ({
                    branchId: input.branchId,
                    locationId,
                  })),
                },
              })),
            },
          },
          include: { components: { include: { locations: true } } },
        });
        return this.result(
          input.branchId,
          "critical-ingredient-rule",
          rule.id,
          "inventory-availability.rule.created",
          input.reason,
          rule,
        );
      },
    );
  }

  confirmRule(
    ruleId: string,
    input: ConfirmCriticalIngredientRule,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.changeRule(
      "confirm",
      ruleId,
      input,
      key,
      principal,
      InventoryPolicyStatus.DRAFT,
      {
        status: InventoryPolicyStatus.CONFIRMED,
        evidenceReference: input.evidenceReference,
        confirmedById: principal.userId,
        confirmedAt: new Date(),
      },
    );
  }

  activateRule(
    ruleId: string,
    input: CriticalIngredientRuleRevision,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.changeRule(
      "activate",
      ruleId,
      input,
      key,
      principal,
      InventoryPolicyStatus.CONFIRMED,
      {
        status: InventoryPolicyStatus.ACTIVE,
        activatedById: principal.userId,
        activatedAt: new Date(),
      },
    );
  }

  cancelRule(
    ruleId: string,
    input: CriticalIngredientRuleRevision,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-availability.rule.cancel",
      key,
      { ruleId, ...input },
      principal,
      async (tx) => {
        const rule = await this.rule(tx, ruleId, input.branchId, principal);
        this.revision(rule.revision, input.revision);
        if (
          rule.status !== InventoryPolicyStatus.DRAFT &&
          rule.status !== InventoryPolicyStatus.CONFIRMED
        ) {
          throw new ConflictException({ code: "AVAILABILITY_RULE_IMMUTABLE" });
        }
        const cancelled = await tx.criticalIngredientRuleVersion.update({
          where: { id: rule.id },
          data: {
            status: InventoryPolicyStatus.CANCELLED,
            revision: { increment: 1 },
            evidenceReference: null,
            confirmedById: null,
            confirmedAt: null,
          },
        });
        return this.result(
          input.branchId,
          "critical-ingredient-rule",
          rule.id,
          "inventory-availability.rule.cancelled",
          input.reason,
          cancelled,
        );
      },
    );
  }

  recordManual(
    input: RecordManualAvailability,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "catalog.availability.manage", input.branchId);
    return this.idempotent(
      "inventory-availability.manual.record",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(tx, input.branchId, principal.organizationId);
        await this.assertTarget(tx, input);
        const kind = input.targetKind as AvailabilityTargetKind;
        const keyValue = targetKey(kind, input);
        const latest = await tx.manualAvailabilityEvent.findFirst({
          where: { branchId: input.branchId, targetKey: keyValue },
          orderBy: { revision: "desc" },
        });
        const currentRevision = latest?.revision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          throw new ConflictException({ code: "STALE_REVISION" });
        }
        let event;
        try {
          event = await tx.manualAvailabilityEvent.create({
            data: {
              id: input.eventId,
              branchId: input.branchId,
              targetKind: kind,
              targetKey: keyValue,
              menuItemId: input.menuItemId ?? null,
              menuVariantId: input.menuVariantId ?? null,
              menuModifierId: input.menuModifierId ?? null,
              state: input.state as ManualAvailabilityState,
              revision: currentRevision + 1,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              effectiveFrom: new Date(input.effectiveFrom),
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              reason: input.reason,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw new ConflictException({ code: "STALE_REVISION" });
          }
          throw error;
        }
        return this.result(
          input.branchId,
          "manual-availability-event",
          event.id,
          `inventory-availability.manual.${input.state.toLowerCase()}`,
          input.reason,
          event,
        );
      },
    );
  }

  async assertOrderSelection(
    tx: Tx,
    input: {
      branchId: string;
      menuItemId: string;
      menuVariantId: string | null;
      menuModifierIds: readonly string[];
      quantity: number;
      at: Date;
    },
  ) {
    const result = await this.resolve(tx, {
      branchId: input.branchId,
      menuItemId: input.menuItemId,
      menuVariantId: input.menuVariantId,
      quantity: input.quantity,
      at: input.at.toISOString(),
    });
    if (!result.available) {
      throw new BadRequestException({
        code: result.issueCode,
        message: "The selected catalog entry is currently unavailable.",
        details: jsonSafe(result),
      });
    }
    if (!input.menuModifierIds.length) return;
    const keys = [...new Set(input.menuModifierIds)].map(
      (id) => `MODIFIER:${id}`,
    );
    const events = await this.latestManualEvents(
      tx,
      input.branchId,
      keys,
      input.at,
    );
    const unavailable = events.find((event) =>
      this.isUnavailable(event, input.at),
    );
    if (unavailable) {
      throw new BadRequestException({
        code: "CATALOG_ENTRY_MANUALLY_UNAVAILABLE",
        targetKey: unavailable.targetKey,
      });
    }
  }

  private async resolve(db: Db, input: AvailabilityPreview) {
    const at = new Date(input.at);
    const item = await db.menuItem.findFirst({
      where: { id: input.menuItemId, branchId: input.branchId },
      include: { variants: true },
    });
    if (!item) throw new NotFoundException("Menu item not found.");
    const variant = input.menuVariantId
      ? item.variants.find(({ id }) => id === input.menuVariantId)
      : null;
    if (input.menuVariantId && !variant) {
      throw new NotFoundException("Menu variant not found.");
    }
    const keys = [
      `ITEM:${item.id}`,
      ...(variant ? [`VARIANT:${variant.id}`] : []),
    ];
    const manualEvents = await this.latestManualEvents(
      db,
      input.branchId,
      keys,
      at,
    );
    const manualUnavailable = manualEvents.find((event) =>
      this.isUnavailable(event, at),
    );
    const catalogAvailable =
      item.isActive &&
      item.isAvailable &&
      (!variant || (variant.isActive && variant.isAvailable));
    if (!catalogAvailable || manualUnavailable) {
      return {
        configured: false,
        available: false,
        issueCode: manualUnavailable
          ? "CATALOG_ENTRY_MANUALLY_UNAVAILABLE"
          : "CATALOG_ENTRY_UNAVAILABLE",
        at,
        quantity: input.quantity,
        menuItemId: item.id,
        menuVariantId: variant?.id ?? null,
        manualEventId: manualUnavailable?.id ?? null,
        components: [],
      };
    }
    const rule = await db.criticalIngredientRuleVersion.findFirst({
      where: {
        branchId: input.branchId,
        menuItemId: item.id,
        menuVariantId: variant?.id ?? null,
        status: InventoryPolicyStatus.ACTIVE,
        effectiveFrom: { lte: at },
      },
      include: {
        recipeVersion: { include: { components: true } },
        components: {
          include: { locations: true, inventoryItem: true },
          orderBy: { inventoryItemId: "asc" },
        },
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }, { id: "desc" }],
    });
    if (!rule) {
      return {
        configured: false,
        available: true,
        issueCode: "STOCK_AVAILABILITY_POLICY_NOT_CONFIGURED",
        at,
        quantity: input.quantity,
        menuItemId: item.id,
        menuVariantId: variant?.id ?? null,
        manualEventId: null,
        components: [],
      };
    }
    const recipe = rule.recipeVersion;
    if (
      recipe.status !== RecipeStatus.ACTIVE ||
      recipe.branchId !== input.branchId ||
      recipe.menuItemId !== item.id ||
      recipe.menuVariantId !== (variant?.id ?? null) ||
      recipe.effectiveFrom > at ||
      recipe.yieldQuantityMicros <= 0n
    ) {
      throw new ConflictException({ code: "AVAILABILITY_RULE_INVALID" });
    }
    const recipeComponents = new Map(
      recipe.components.map((component) => [
        component.inventoryItemId,
        component,
      ]),
    );
    const inventoryItemIds = rule.components.map(
      (component) => component.inventoryItemId,
    );
    const locationIds = [
      ...new Set(
        rule.components.flatMap((component) =>
          component.locations.map((location) => location.locationId),
        ),
      ),
    ];
    const balances =
      inventoryItemIds.length && locationIds.length
        ? await db.stockLedgerEntry.groupBy({
            by: ["inventoryItemId", "locationId"],
            where: {
              branchId: input.branchId,
              inventoryItemId: { in: inventoryItemIds },
              locationId: { in: locationIds },
            },
            _sum: { quantityDeltaMicros: true },
          })
        : [];
    const balanceByPair = new Map(
      balances.map((row) => [
        `${row.inventoryItemId}:${row.locationId}`,
        row._sum.quantityDeltaMicros ?? 0n,
      ]),
    );
    let available = true;
    let maxSellableQuantity: bigint | null = null;
    const components = rule.components.map((component) => {
      const recipeComponent = recipeComponents.get(component.inventoryItemId);
      if (
        !recipeComponent ||
        !component.inventoryItem.isActive ||
        !component.locations.length
      ) {
        throw new ConflictException({ code: "AVAILABILITY_RULE_INVALID" });
      }
      const numerator =
        recipeComponent.quantityMicros * BigInt(input.quantity) * 1_000_000n;
      if (numerator % recipe.yieldQuantityMicros !== 0n) {
        throw new ConflictException({
          code: "AVAILABILITY_FRACTIONAL_MICRO",
          inventoryItemId: component.inventoryItemId,
        });
      }
      const requiredQuantityMicros = numerator / recipe.yieldQuantityMicros;
      const balanceMicros = component.locations.reduce(
        (sum, location) =>
          sum +
          (balanceByPair.get(
            `${component.inventoryItemId}:${location.locationId}`,
          ) ?? 0n),
        0n,
      );
      const usableMicros = balanceMicros - component.safetyStockMicros;
      const componentAvailable = usableMicros >= requiredQuantityMicros;
      available &&= componentAvailable;
      const capacity =
        usableMicros <= 0n
          ? 0n
          : (usableMicros * recipe.yieldQuantityMicros) /
            (recipeComponent.quantityMicros * 1_000_000n);
      maxSellableQuantity =
        maxSellableQuantity === null || capacity < maxSellableQuantity
          ? capacity
          : maxSellableQuantity;
      return {
        inventoryItemId: component.inventoryItemId,
        inventoryItemName: component.inventoryItem.name,
        locationIds: component.locations.map(({ locationId }) => locationId),
        balanceMicros,
        safetyStockMicros: component.safetyStockMicros,
        usableMicros,
        requiredQuantityMicros,
        available: componentAvailable,
      };
    });
    return {
      configured: true,
      available,
      issueCode: available ? null : "CRITICAL_STOCK_INSUFFICIENT",
      at,
      quantity: input.quantity,
      menuItemId: item.id,
      menuVariantId: variant?.id ?? null,
      manualEventId: null,
      ruleVersionId: rule.id,
      ruleVersion: rule.version,
      recipeVersionId: recipe.id,
      maxSellableQuantity: maxSellableQuantity ?? 0n,
      components,
    };
  }

  private async latestManualEvents(
    db: Db,
    branchId: string,
    keys: string[],
    at: Date,
  ) {
    if (!keys.length) return [];
    const rows = await db.manualAvailabilityEvent.findMany({
      where: { branchId, targetKey: { in: keys }, effectiveFrom: { lte: at } },
      orderBy: [{ targetKey: "asc" }, { revision: "desc" }],
    });
    const selected = new Map<string, (typeof rows)[number]>();
    for (const row of rows)
      if (!selected.has(row.targetKey)) selected.set(row.targetKey, row);
    return [...selected.values()];
  }

  private isUnavailable(
    event: { state: ManualAvailabilityState; expiresAt: Date | null },
    at: Date,
  ) {
    return (
      event.state === ManualAvailabilityState.UNAVAILABLE &&
      (!event.expiresAt || event.expiresAt > at)
    );
  }

  private async assertTarget(db: Db, input: RecordManualAvailability) {
    if (input.targetKind === "ITEM") {
      if (
        !(await db.menuItem.count({
          where: { id: input.menuItemId, branchId: input.branchId },
        }))
      )
        throw new NotFoundException("Menu item not found.");
      return;
    }
    if (input.targetKind === "VARIANT") {
      if (
        !(await db.menuVariant.count({
          where: {
            id: input.menuVariantId,
            menuItemId: input.menuItemId,
            menuItem: { branchId: input.branchId },
          },
        }))
      )
        throw new NotFoundException("Menu variant not found.");
      return;
    }
    if (
      !(await db.menuModifier.count({
        where: {
          id: input.menuModifierId,
          group: { branchId: input.branchId },
        },
      }))
    )
      throw new NotFoundException("Menu modifier not found.");
  }

  private changeRule(
    action: "confirm" | "activate",
    ruleId: string,
    input: CriticalIngredientRuleRevision | ConfirmCriticalIngredientRule,
    key: string,
    principal: AuthPrincipal,
    expectedStatus: InventoryPolicyStatus,
    data: Prisma.CriticalIngredientRuleVersionUncheckedUpdateInput,
  ) {
    return this.idempotent(
      `inventory-availability.rule.${action}`,
      key,
      { ruleId, ...input },
      principal,
      async (tx) => {
        const rule = await this.rule(tx, ruleId, input.branchId, principal);
        this.revision(rule.revision, input.revision);
        if (rule.status !== expectedStatus) {
          throw new ConflictException({
            code: "AVAILABILITY_RULE_STATE_INVALID",
          });
        }
        const updated = await tx.criticalIngredientRuleVersion.update({
          where: { id: rule.id },
          data: { ...data, revision: { increment: 1 } },
          include: { components: { include: { locations: true } } },
        });
        return this.result(
          input.branchId,
          "critical-ingredient-rule",
          rule.id,
          `inventory-availability.rule.${
            action === "confirm" ? "confirmed" : "activated"
          }`,
          input.reason,
          updated,
        );
      },
    );
  }

  private async rule(
    db: Db,
    ruleId: string,
    branchId: string,
    principal: AuthPrincipal,
  ) {
    const rule = await db.criticalIngredientRuleVersion.findFirst({
      where: {
        id: ruleId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: { components: true },
    });
    if (!rule)
      throw new NotFoundException("Critical ingredient rule not found.");
    return rule;
  }

  private revision(current: number, supplied: number) {
    if (current !== supplied)
      throw new ConflictException({ code: "STALE_REVISION" });
  }

  private async branch(db: Db, branchId: string, organizationId: string) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, organizationId },
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
    if (!hasPermission(principal, permission, branchId))
      throw new ForbiddenException("Permission denied for branch.");
  }

  private result(
    branchId: string,
    entityType: string,
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
  ): MutationResult {
    return {
      branchId,
      entityType,
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
    const hashValue = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hashValue)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const result = await work(tx);
        const response = asJson(result.response);
        await tx.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            branchId: result.branchId,
            actorId: principal.userId,
            action: scope,
            entityType: result.entityType,
            entityId: result.entityId,
            reason: result.reason,
            metadata: { deviceId: principal.deviceId },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: result.entityType,
            aggregateId: result.entityId,
            eventType: result.eventType,
            payload: {
              organizationId: principal.organizationId,
              branchId: result.branchId,
              entityId: result.entityId,
            },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            actorId: principal.userId,
            scope,
            key,
            requestHash: hashValue,
            responseBody: response,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
