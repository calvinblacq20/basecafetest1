import { randomUUID } from "node:crypto";
import type {
  ActivateRecipeVersion,
  CreateInventoryItem,
  CreateInventoryUnit,
  CreateInventoryUnitConversion,
  CreateRecipeVersion,
  CreateStockCount,
  CreateStockLocation,
  InventoryBranchQuery,
  InventoryConsumptionPreview,
  InventoryLedgerQuery,
  PostInventoryTransfer,
  PostStockAdjustment,
  PostStockCount,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  RecipeStatus,
  StockCountStatus,
  StockLedgerType,
} from "@prisma/client";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;
type MutationResult = {
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

const asInputJson = (value: unknown) =>
  jsonSafe(value) as Prisma.InputJsonObject;

const unitSummarySelect = Prisma.validator<Prisma.InventoryUnitSelect>()({
  id: true,
  code: true,
  name: true,
  dimension: true,
  isActive: true,
  revision: true,
});

const unitSelect = Prisma.validator<Prisma.InventoryUnitSelect>()({
  ...unitSummarySelect,
  createdAt: true,
  updatedAt: true,
  conversionsFrom: {
    select: {
      id: true,
      fromUnitId: true,
      toUnitId: true,
      numerator: true,
      denominator: true,
      createdAt: true,
      toUnit: { select: unitSummarySelect },
    },
  },
});

const itemSelect = Prisma.validator<Prisma.InventoryItemSelect>()({
  id: true,
  branchId: true,
  baseUnitId: true,
  externalKey: true,
  name: true,
  isActive: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  baseUnit: { select: unitSummarySelect },
});

const recipeSelect = Prisma.validator<Prisma.RecipeVersionSelect>()({
  id: true,
  branchId: true,
  menuItemId: true,
  menuVariantId: true,
  version: true,
  status: true,
  revision: true,
  yieldQuantityMicros: true,
  effectiveFrom: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  menuItem: { select: { id: true, name: true } },
  menuVariant: { select: { id: true, name: true } },
  components: {
    select: {
      inventoryItemId: true,
      quantityMicros: true,
      inventoryItem: { select: itemSelect },
    },
    orderBy: { inventoryItemId: "asc" },
  },
});

const transferSelect = Prisma.validator<Prisma.InventoryTransferSelect>()({
  id: true,
  branchId: true,
  inventoryItemId: true,
  fromLocationId: true,
  toLocationId: true,
  quantityMicros: true,
  reason: true,
  createdAt: true,
  inventoryItem: { select: itemSelect },
  fromLocation: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
  actor: { select: { displayName: true } },
});

const countSelect = Prisma.validator<Prisma.StockCountSelect>()({
  id: true,
  branchId: true,
  locationId: true,
  status: true,
  revision: true,
  reason: true,
  postedAt: true,
  createdAt: true,
  updatedAt: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { displayName: true } },
  postedBy: { select: { displayName: true } },
  lines: {
    select: {
      inventoryItemId: true,
      countedQuantityMicros: true,
      inventoryItem: { select: itemSelect },
    },
    orderBy: { inventoryItemId: "asc" },
  },
});

const ledgerSelect = Prisma.validator<Prisma.StockLedgerEntrySelect>()({
  id: true,
  branchId: true,
  locationId: true,
  inventoryItemId: true,
  type: true,
  quantityDeltaMicros: true,
  sourceType: true,
  sourceId: true,
  negativeStockOverride: true,
  reason: true,
  occurredAt: true,
  createdAt: true,
  location: { select: { id: true, name: true } },
  inventoryItem: {
    select: { id: true, name: true, baseUnit: { select: unitSummarySelect } },
  },
  actor: { select: { displayName: true } },
});

type LedgerProjection = Prisma.StockLedgerEntryGetPayload<{
  select: typeof ledgerSelect;
}>;

function publicLedger(entry: LedgerProjection) {
  const { actor, ...visible } = entry;
  return jsonSafe({ ...visible, actorDisplayName: actor.displayName });
}

type TransferProjection = Prisma.InventoryTransferGetPayload<{
  select: typeof transferSelect;
}>;
type CountProjection = Prisma.StockCountGetPayload<{
  select: typeof countSelect;
}>;

function publicTransfer(transfer: TransferProjection) {
  const { actor, ...visible } = transfer;
  return jsonSafe({ ...visible, actorDisplayName: actor.displayName });
}

function publicCount(count: CountProjection) {
  const { createdBy, postedBy, ...visible } = count;
  return jsonSafe({
    ...visible,
    createdByDisplayName: createdBy.displayName,
    postedByDisplayName: postedBy?.displayName ?? null,
  });
}

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listUnits(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    const branch = await this.branch(branchId, principal);
    const units = await this.prisma.inventoryUnit.findMany({
      where: {
        organizationId: branch.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      select: unitSelect,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: query.limit,
    });
    return jsonSafe(units);
  }

  async listLocations(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return this.prisma.stockLocation.findMany({
      where: { branchId, ...(query.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit,
    });
  }

  async listItems(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      await this.prisma.inventoryItem.findMany({
        where: {
          branchId,
          ...(query.includeInactive ? {} : { isActive: true }),
        },
        select: itemSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: query.limit,
      }),
    );
  }

  async listRecipes(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      await this.prisma.recipeVersion.findMany({
        where: {
          branchId,
          ...(query.includeInactive
            ? {}
            : { status: { not: RecipeStatus.CANCELLED } }),
        },
        select: recipeSelect,
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
        take: query.limit,
      }),
    );
  }

  async listTransfers(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.inventoryTransfer.findMany({
      where: { branchId },
      select: transferSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return rows.map(publicTransfer);
  }

  async listCounts(
    branchId: string,
    query: InventoryBranchQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.stockCount.findMany({
      where: { branchId },
      select: countSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return rows.map(publicCount);
  }

  async listLedger(
    branchId: string,
    query: InventoryLedgerQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      await this.prisma.stockLedgerEntry
        .findMany({
          where: {
            branchId,
            ...(query.locationId ? { locationId: query.locationId } : {}),
            ...(query.inventoryItemId
              ? { inventoryItemId: query.inventoryItemId }
              : {}),
            ...(query.type ? { type: query.type } : {}),
          },
          select: ledgerSelect,
          orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          take: query.limit,
        })
        .then((entries) => entries.map(publicLedger)),
    );
  }

  async balances(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    const rows = await this.prisma.stockLedgerEntry.groupBy({
      by: ["locationId", "inventoryItemId"],
      where: { branchId },
      _sum: { quantityDeltaMicros: true },
      orderBy: [{ locationId: "asc" }, { inventoryItemId: "asc" }],
    });
    return jsonSafe(
      rows.map((row) => ({
        locationId: row.locationId,
        inventoryItemId: row.inventoryItemId,
        quantityMicros: row._sum.quantityDeltaMicros ?? 0n,
      })),
    );
  }

  createUnit(
    input: CreateInventoryUnit,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.unit.create",
      key,
      input,
      principal,
      async (tx) => {
        const branch = await this.branch(input.branchId, principal, tx);
        const unit = await tx.inventoryUnit.create({
          data: {
            id: input.unitId,
            organizationId: branch.organizationId,
            code: input.code,
            name: input.name,
            dimension: input.dimension,
          },
          select: unitSelect,
        });
        return this.result(
          unit.id,
          "inventory.unit.created",
          input.reason,
          unit,
        );
      },
    );
  }

  createConversion(
    input: CreateInventoryUnitConversion,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.conversion.create",
      key,
      input,
      principal,
      async (tx) => {
        const branch = await this.branch(input.branchId, principal, tx);
        if (input.fromUnitId === input.toUnitId) {
          throw new ConflictException({ code: "INVENTORY_CONVERSION_INVALID" });
        }
        const units = await tx.inventoryUnit.findMany({
          where: {
            organizationId: branch.organizationId,
            id: { in: [input.fromUnitId, input.toUnitId] },
            isActive: true,
          },
        });
        if (units.length !== 2) {
          throw new ConflictException({ code: "INVENTORY_UNIT_UNAVAILABLE" });
        }
        if (units[0]?.dimension !== units[1]?.dimension) {
          throw new ConflictException({ code: "INVENTORY_DIMENSION_MISMATCH" });
        }
        const conversion = await tx.inventoryUnitConversion.create({
          data: {
            id: input.conversionId,
            organizationId: branch.organizationId,
            fromUnitId: input.fromUnitId,
            toUnitId: input.toUnitId,
            numerator: BigInt(input.numerator),
            denominator: BigInt(input.denominator),
          },
          select: {
            id: true,
            fromUnitId: true,
            toUnitId: true,
            numerator: true,
            denominator: true,
            createdAt: true,
            toUnit: { select: unitSummarySelect },
          },
        });
        return this.result(
          conversion.id,
          "inventory.conversion.created",
          input.reason,
          conversion,
        );
      },
    );
  }

  createLocation(
    input: CreateStockLocation,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.location.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const location = await tx.stockLocation.create({
          data: {
            id: input.locationId,
            branchId: input.branchId,
            externalKey: input.externalKey,
            name: input.name,
            kind: input.kind,
          },
        });
        return this.result(
          location.id,
          "inventory.location.created",
          input.reason,
          location,
        );
      },
    );
  }

  createItem(
    input: CreateInventoryItem,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.item.create",
      key,
      input,
      principal,
      async (tx) => {
        const branch = await this.branch(input.branchId, principal, tx);
        const unit = await tx.inventoryUnit.findFirst({
          where: {
            id: input.baseUnitId,
            organizationId: branch.organizationId,
            isActive: true,
          },
        });
        if (!unit)
          throw new ConflictException({ code: "INVENTORY_UNIT_UNAVAILABLE" });
        const item = await tx.inventoryItem.create({
          data: {
            id: input.inventoryItemId,
            branchId: input.branchId,
            baseUnitId: input.baseUnitId,
            externalKey: input.externalKey,
            name: input.name,
          },
          select: itemSelect,
        });
        return this.result(
          item.id,
          "inventory.item.created",
          input.reason,
          item,
        );
      },
    );
  }

  createRecipe(
    input: CreateRecipeVersion,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.recipe.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const menuItem = await tx.menuItem.findFirst({
          where: { id: input.menuItemId, branchId: input.branchId },
        });
        if (!menuItem)
          throw new ConflictException({ code: "CATALOG_ENTRY_UNAVAILABLE" });
        if (input.menuVariantId) {
          const variant = await tx.menuVariant.findFirst({
            where: { id: input.menuVariantId, menuItemId: input.menuItemId },
          });
          if (!variant)
            throw new ConflictException({ code: "CATALOG_ENTRY_UNAVAILABLE" });
        }
        const componentItems = await tx.inventoryItem.count({
          where: {
            branchId: input.branchId,
            id: {
              in: input.components.map(
                (component) => component.inventoryItemId,
              ),
            },
            isActive: true,
          },
        });
        if (componentItems !== input.components.length) {
          throw new ConflictException({ code: "INVENTORY_ITEM_UNAVAILABLE" });
        }
        const latest = await tx.recipeVersion.findFirst({
          where: {
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
          },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const recipe = await tx.recipeVersion.create({
          data: {
            id: input.recipeVersionId,
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
            version: (latest?.version ?? 0) + 1,
            yieldQuantityMicros: BigInt(input.yieldQuantityMicros),
            effectiveFrom: new Date(input.effectiveFrom),
            createdById: principal.userId,
            components: {
              create: input.components.map((component) => ({
                inventoryItemId: component.inventoryItemId,
                quantityMicros: BigInt(component.quantityMicros),
              })),
            },
          },
          select: recipeSelect,
        });
        return this.result(
          recipe.id,
          "inventory.recipe.created",
          input.reason,
          recipe,
        );
      },
    );
  }

  activateRecipe(
    recipeId: string,
    input: ActivateRecipeVersion,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory.recipe.activate",
      key,
      { recipeId, ...input },
      principal,
      async (tx) => {
        const recipe = await tx.recipeVersion.findFirst({
          where: {
            id: recipeId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (!recipe) throw new NotFoundException("Recipe version not found.");
        if (recipe.revision !== input.revision) {
          throw new ConflictException({ code: "STALE_REVISION" });
        }
        if (recipe.status !== RecipeStatus.DRAFT) {
          throw new ConflictException({ code: "RECIPE_ACTIVATION_INVALID" });
        }
        const updated = await tx.recipeVersion.update({
          where: { id: recipe.id },
          data: {
            status: RecipeStatus.ACTIVE,
            revision: { increment: 1 },
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
          select: recipeSelect,
        });
        return this.result(
          updated.id,
          "inventory.recipe.activated",
          input.reason,
          updated,
        );
      },
    );
  }

  postAdjustment(
    input: PostStockAdjustment,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.write", input.branchId);
    if (input.type === "WASTE" && !input.quantityDeltaMicros.startsWith("-")) {
      throw new ConflictException({
        code: "INVENTORY_WASTE_MUST_DECREASE_STOCK",
      });
    }
    if (
      input.type === "OPENING_BALANCE" &&
      input.quantityDeltaMicros.startsWith("-")
    ) {
      throw new ConflictException({
        code: "INVENTORY_OPENING_BALANCE_INVALID",
      });
    }
    return this.idempotent(
      "inventory.adjustment.post",
      key,
      input,
      principal,
      async (tx) => {
        await this.assertStockTarget(
          tx,
          input.branchId,
          input.locationId,
          input.inventoryItemId,
          principal,
        );
        const delta = BigInt(input.quantityDeltaMicros);
        await this.assertNonNegative(
          tx,
          input.branchId,
          input.locationId,
          input.inventoryItemId,
          delta,
          input.allowNegativeOverride,
          principal,
        );
        const entry = await tx.stockLedgerEntry.create({
          data: {
            id: input.ledgerEntryId,
            branchId: input.branchId,
            locationId: input.locationId,
            inventoryItemId: input.inventoryItemId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: input.type,
            quantityDeltaMicros: delta,
            sourceType: "MANUAL_STOCK_COMMAND",
            sourceId: input.ledgerEntryId,
            negativeStockOverride: input.allowNegativeOverride,
            reason: input.reason,
            occurredAt: new Date(),
          },
          select: ledgerSelect,
        });
        return this.result(
          entry.id,
          "inventory.ledger.posted",
          input.reason,
          publicLedger(entry),
        );
      },
    );
  }

  postTransfer(
    input: PostInventoryTransfer,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.write", input.branchId);
    return this.idempotent(
      "inventory.transfer.post",
      key,
      input,
      principal,
      async (tx) => {
        await this.assertStockTarget(
          tx,
          input.branchId,
          input.fromLocationId,
          input.inventoryItemId,
          principal,
        );
        await this.assertStockTarget(
          tx,
          input.branchId,
          input.toLocationId,
          input.inventoryItemId,
          principal,
        );
        const quantity = BigInt(input.quantityMicros);
        await this.assertNonNegative(
          tx,
          input.branchId,
          input.fromLocationId,
          input.inventoryItemId,
          -quantity,
          input.allowNegativeOverride,
          principal,
        );
        const transfer = await tx.inventoryTransfer.create({
          data: {
            id: input.transferId,
            branchId: input.branchId,
            inventoryItemId: input.inventoryItemId,
            fromLocationId: input.fromLocationId,
            toLocationId: input.toLocationId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            quantityMicros: quantity,
            reason: input.reason,
          },
          select: transferSelect,
        });
        const common = {
          branchId: input.branchId,
          inventoryItemId: input.inventoryItemId,
          actorId: principal.userId,
          deviceId: principal.deviceId,
          sourceType: "INVENTORY_TRANSFER",
          sourceId: transfer.id,
          reason: input.reason,
          occurredAt: transfer.createdAt,
        };
        await Promise.all([
          tx.stockLedgerEntry.create({
            data: {
              ...common,
              id: input.outboundEntryId,
              locationId: input.fromLocationId,
              type: StockLedgerType.TRANSFER_OUT,
              quantityDeltaMicros: -quantity,
              negativeStockOverride: input.allowNegativeOverride,
            },
          }),
          tx.stockLedgerEntry.create({
            data: {
              ...common,
              id: input.inboundEntryId,
              locationId: input.toLocationId,
              type: StockLedgerType.TRANSFER_IN,
              quantityDeltaMicros: quantity,
            },
          }),
        ]);
        return this.result(
          transfer.id,
          "inventory.transfer.posted",
          input.reason,
          publicTransfer(transfer),
        );
      },
    );
  }

  createCount(input: CreateStockCount, key: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.write", input.branchId);
    return this.idempotent(
      "inventory.count.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const location = await tx.stockLocation.findFirst({
          where: {
            id: input.locationId,
            branchId: input.branchId,
            isActive: true,
          },
        });
        const itemCount = await tx.inventoryItem.count({
          where: {
            branchId: input.branchId,
            id: { in: input.lines.map((line) => line.inventoryItemId) },
            isActive: true,
          },
        });
        if (!location || itemCount !== input.lines.length) {
          throw new ConflictException({
            code: "INVENTORY_COUNT_TARGET_INVALID",
          });
        }
        const count = await tx.stockCount.create({
          data: {
            id: input.stockCountId,
            branchId: input.branchId,
            locationId: input.locationId,
            createdById: principal.userId,
            reason: input.reason,
            lines: {
              create: input.lines.map((line) => ({
                inventoryItemId: line.inventoryItemId,
                countedQuantityMicros: BigInt(line.countedQuantityMicros),
              })),
            },
          },
          select: countSelect,
        });
        return this.result(
          count.id,
          "inventory.count.created",
          input.reason,
          publicCount(count),
        );
      },
    );
  }

  postCount(
    countId: string,
    input: PostStockCount,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.write", input.branchId);
    return this.idempotent(
      "inventory.count.post",
      key,
      { countId, ...input },
      principal,
      async (tx) => {
        const count = await tx.stockCount.findFirst({
          where: {
            id: countId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          select: countSelect,
        });
        if (!count) throw new NotFoundException("Stock count not found.");
        if (count.revision !== input.revision) {
          throw new ConflictException({ code: "STALE_REVISION" });
        }
        if (count.status !== StockCountStatus.DRAFT) {
          throw new ConflictException({ code: "STOCK_COUNT_POST_INVALID" });
        }
        const occurredAt = new Date();
        const entries = [];
        for (const line of count.lines) {
          const current = await this.balance(
            tx,
            count.branchId,
            count.locationId,
            line.inventoryItemId,
          );
          const delta = line.countedQuantityMicros - current;
          if (delta === 0n) continue;
          entries.push(
            await tx.stockLedgerEntry.create({
              data: {
                id: randomUUID(),
                branchId: count.branchId,
                locationId: count.locationId,
                inventoryItemId: line.inventoryItemId,
                actorId: principal.userId,
                deviceId: principal.deviceId,
                type: StockLedgerType.COUNT_ADJUSTMENT,
                quantityDeltaMicros: delta,
                sourceType: "STOCK_COUNT",
                sourceId: count.id,
                reason: input.reason,
                occurredAt,
              },
              select: ledgerSelect,
            }),
          );
        }
        const posted = await tx.stockCount.update({
          where: { id: count.id },
          data: {
            status: StockCountStatus.POSTED,
            revision: { increment: 1 },
            postedById: principal.userId,
            postedAt: occurredAt,
          },
          select: countSelect,
        });
        return this.result(posted.id, "inventory.count.posted", input.reason, {
          count: publicCount(posted),
          entries: entries.map(publicLedger),
        });
      },
    );
  }

  async consumptionPreview(
    input: InventoryConsumptionPreview,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", input.branchId);
    await this.branch(input.branchId, principal);
    const at = input.at ? new Date(input.at) : new Date();
    const recipe = await this.prisma.recipeVersion.findFirst({
      where: {
        branchId: input.branchId,
        menuItemId: input.menuItemId,
        menuVariantId: input.menuVariantId ?? null,
        status: RecipeStatus.ACTIVE,
        effectiveFrom: { lte: at },
      },
      include: {
        components: {
          include: { inventoryItem: { include: { baseUnit: true } } },
        },
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    });
    if (!recipe) {
      return {
        configured: false,
        code: "RECIPE_CONFIGURATION_MISSING",
        automaticDeductionEnabled: false,
      };
    }
    const factor = BigInt(input.quantity) * 1_000_000n;
    const components = recipe.components.map((component) => {
      const numerator = component.quantityMicros * factor;
      const quotient = numerator / recipe.yieldQuantityMicros;
      const remainder = numerator % recipe.yieldQuantityMicros;
      const rounded =
        quotient + (remainder * 2n >= recipe.yieldQuantityMicros ? 1n : 0n);
      return {
        inventoryItemId: component.inventoryItemId,
        inventoryItemName: component.inventoryItem.name,
        baseUnitCode: component.inventoryItem.baseUnit.code,
        requiredQuantityMicros: rounded.toString(),
        exactNumerator: numerator.toString(),
        exactDenominator: recipe.yieldQuantityMicros.toString(),
      };
    });
    return {
      configured: true,
      automaticDeductionEnabled: false,
      configurationIssue: "INVENTORY_DEDUCTION_TRIGGER_UNCONFIRMED",
      provisionalRounding: "HALF_UP_TO_MICRO_UNIT",
      recipeVersionId: recipe.id,
      recipeVersion: recipe.version,
      components,
    };
  }

  private async assertStockTarget(
    tx: Tx,
    branchId: string,
    locationId: string,
    itemId: string,
    principal: AuthPrincipal,
  ) {
    await this.branch(branchId, principal, tx);
    const [location, item] = await Promise.all([
      tx.stockLocation.findFirst({
        where: { id: locationId, branchId, isActive: true },
      }),
      tx.inventoryItem.findFirst({
        where: { id: itemId, branchId, isActive: true },
      }),
    ]);
    if (!location || !item) {
      throw new ConflictException({ code: "INVENTORY_STOCK_TARGET_INVALID" });
    }
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
    if (delta >= 0n) return;
    const resulting =
      (await this.balance(tx, branchId, locationId, itemId)) + delta;
    if (resulting >= 0n) return;
    if (!override) {
      throw new ConflictException({
        code: "NEGATIVE_STOCK_POLICY_UNCONFIRMED",
      });
    }
    this.permission(principal, "inventory.manage", branchId);
  }

  private async balance(
    tx: Tx,
    branchId: string,
    locationId: string,
    itemId: string,
  ) {
    const aggregate = await tx.stockLedgerEntry.aggregate({
      where: { branchId, locationId, inventoryItemId: itemId },
      _sum: { quantityDeltaMicros: true },
    });
    return aggregate._sum.quantityDeltaMicros ?? 0n;
  }

  private async branch(
    branchId: string,
    principal: AuthPrincipal,
    tx: Tx | PrismaService = this.prisma,
  ) {
    const branch = await tx.branch.findFirst({
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
    return { entityId, eventType, reason, response };
  }

  private async idempotent(
    scope: string,
    key: string,
    command: { branchId: string } & Record<string, unknown>,
    principal: AuthPrincipal,
    work: (transaction: Tx) => Promise<MutationResult>,
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
          const response = asInputJson(result.response);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: command.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "inventory",
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
              aggregateType: "inventory",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: command.branchId,
                inventoryEntityId: result.entityId,
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
        throw new ConflictException({ code: "INVENTORY_CONFLICT" });
      }
      throw error;
    }
  }
}
