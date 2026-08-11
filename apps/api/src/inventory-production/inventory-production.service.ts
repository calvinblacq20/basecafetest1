import type {
  ActivateBatchRecipeVersion,
  ActivateModifierRecipeEffect,
  BatchProductionPreview,
  CreateBatchRecipeVersion,
  CreateModifierRecipeEffect,
  InventoryProductionListQuery,
  PostBatchProduction,
  ReverseBatchProduction,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, RecipeStatus, StockLedgerType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
type Result = {
  entityId: string;
  eventType: string;
  reason: string;
  response: unknown;
};
type ResolvedInput = {
  inventoryItemId: string;
  inventoryItemName: string;
  locationId: string;
  quantityMicros: bigint;
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

const modifierEffectSelect =
  Prisma.validator<Prisma.ModifierRecipeEffectVersionSelect>()({
    id: true,
    branchId: true,
    menuModifierId: true,
    version: true,
    status: true,
    revision: true,
    affectsInventory: true,
    effectiveFrom: true,
    activatedAt: true,
    createdAt: true,
    updatedAt: true,
    menuModifier: { select: { id: true, name: true } },
    components: {
      select: {
        inventoryItemId: true,
        kind: true,
        quantityMicros: true,
        inventoryItem: { select: { id: true, name: true } },
      },
      orderBy: [{ inventoryItemId: "asc" }, { kind: "asc" }],
    },
  });

const productionUnitSelect = Prisma.validator<Prisma.InventoryUnitSelect>()({
  id: true,
  code: true,
  name: true,
  dimension: true,
  isActive: true,
  revision: true,
});

const productionItemSelect = Prisma.validator<Prisma.InventoryItemSelect>()({
  id: true,
  branchId: true,
  baseUnitId: true,
  externalKey: true,
  name: true,
  isActive: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  baseUnit: { select: productionUnitSelect },
});

const batchRecipeSelect = Prisma.validator<Prisma.BatchRecipeVersionSelect>()({
  id: true,
  branchId: true,
  outputInventoryItemId: true,
  version: true,
  status: true,
  revision: true,
  yieldQuantityMicros: true,
  effectiveFrom: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  outputInventoryItem: { select: productionItemSelect },
  components: {
    select: {
      inventoryItemId: true,
      quantityMicros: true,
      inventoryItem: { select: productionItemSelect },
    },
    orderBy: { inventoryItemId: "asc" },
  },
});

const batchProductionSelect = Prisma.validator<Prisma.BatchProductionSelect>()({
  id: true,
  branchId: true,
  batchRecipeVersionId: true,
  outputInventoryItemId: true,
  outputLocationId: true,
  outputQuantityMicros: true,
  outputLedgerEntryId: true,
  revision: true,
  negativeStockOverride: true,
  reason: true,
  occurredAt: true,
  createdAt: true,
  actor: { select: { displayName: true } },
  outputInventoryItem: { select: { id: true, name: true } },
  outputLocation: { select: { id: true, name: true } },
  inputs: {
    select: {
      id: true,
      inventoryItemId: true,
      locationId: true,
      quantityMicros: true,
      ledgerEntryId: true,
      inventoryItem: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { inventoryItemId: "asc" },
  },
  reversal: {
    select: {
      id: true,
      reason: true,
      createdAt: true,
      entries: {
        select: {
          id: true,
          originalLedgerEntryId: true,
          reversalLedgerEntryId: true,
        },
        orderBy: { originalLedgerEntryId: "asc" },
      },
    },
  },
});

type BatchProductionProjection = Prisma.BatchProductionGetPayload<{
  select: typeof batchProductionSelect;
}>;

function publicBatchProduction(production: BatchProductionProjection) {
  const { actor, ...visible } = production;
  return jsonSafe({ ...visible, actorDisplayName: actor.displayName });
}

@Injectable()
export class InventoryProductionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listModifierEffects(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      await this.prisma.modifierRecipeEffectVersion.findMany({
        where: { branchId },
        select: modifierEffectSelect,
        orderBy: [
          { menuModifierId: "asc" },
          { effectiveFrom: "desc" },
          { id: "asc" },
        ],
      }),
    );
  }

  async listBatchRecipes(branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      await this.prisma.batchRecipeVersion.findMany({
        where: { branchId },
        select: batchRecipeSelect,
        orderBy: [
          { outputInventoryItemId: "asc" },
          { effectiveFrom: "desc" },
          { id: "asc" },
        ],
      }),
    );
  }

  async listProductions(
    branchId: string,
    query: InventoryProductionListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.read", branchId);
    await this.branch(branchId, principal);
    return jsonSafe(
      (
        await this.prisma.batchProduction.findMany({
          where: {
            branchId,
            AND: [
              ...(query.inventoryItemId
                ? [
                    {
                      OR: [
                        { outputInventoryItemId: query.inventoryItemId },
                        {
                          inputs: {
                            some: { inventoryItemId: query.inventoryItemId },
                          },
                        },
                      ],
                    },
                  ]
                : []),
              ...(query.locationId
                ? [
                    {
                      OR: [
                        { outputLocationId: query.locationId },
                        { inputs: { some: { locationId: query.locationId } } },
                      ],
                    },
                  ]
                : []),
            ],
          },
          select: batchProductionSelect,
          orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          take: query.limit,
        })
      ).map(publicBatchProduction),
    );
  }

  createModifierEffect(
    input: CreateModifierRecipeEffect,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-production.modifier-effect.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const [modifier, itemCount, latest] = await Promise.all([
          tx.menuModifier.findFirst({
            where: {
              id: input.menuModifierId,
              group: { branchId: input.branchId },
            },
          }),
          tx.inventoryItem.count({
            where: {
              branchId: input.branchId,
              isActive: true,
              id: {
                in: input.components.map(
                  ({ inventoryItemId }) => inventoryItemId,
                ),
              },
            },
          }),
          tx.modifierRecipeEffectVersion.findFirst({
            where: {
              branchId: input.branchId,
              menuModifierId: input.menuModifierId,
            },
            orderBy: { version: "desc" },
            select: { version: true },
          }),
        ]);
        if (!modifier) {
          throw new ConflictException({ code: "CATALOG_ENTRY_UNAVAILABLE" });
        }
        if (itemCount !== input.components.length) {
          throw new ConflictException({ code: "INVENTORY_ITEM_UNAVAILABLE" });
        }
        const effect = await tx.modifierRecipeEffectVersion.create({
          data: {
            id: input.effectVersionId,
            branchId: input.branchId,
            menuModifierId: input.menuModifierId,
            version: (latest?.version ?? 0) + 1,
            affectsInventory: input.affectsInventory,
            effectiveFrom: new Date(input.effectiveFrom),
            createdById: principal.userId,
            components: {
              create: input.components.map((component) => ({
                inventoryItemId: component.inventoryItemId,
                kind: component.kind,
                quantityMicros: BigInt(component.quantityMicros),
              })),
            },
          },
          select: modifierEffectSelect,
        });
        return this.result(
          effect.id,
          "inventory-production.modifier-effect.created",
          input.reason,
          effect,
        );
      },
    );
  }

  activateModifierEffect(
    effectId: string,
    input: ActivateModifierRecipeEffect,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-production.modifier-effect.activate",
      key,
      { effectId, ...input },
      principal,
      async (tx) => {
        const effect = await tx.modifierRecipeEffectVersion.findFirst({
          where: {
            id: effectId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          select: modifierEffectSelect,
        });
        if (!effect) throw new NotFoundException("Modifier effect not found.");
        this.revision(effect.revision, input.revision);
        if (
          effect.status !== RecipeStatus.DRAFT ||
          effect.affectsInventory !== effect.components.length > 0
        ) {
          throw new ConflictException({
            code: "MODIFIER_INVENTORY_EFFECT_ACTIVATION_INVALID",
          });
        }
        const activated = await tx.modifierRecipeEffectVersion.update({
          where: { id: effect.id },
          data: {
            status: RecipeStatus.ACTIVE,
            revision: { increment: 1 },
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
          select: modifierEffectSelect,
        });
        return this.result(
          activated.id,
          "inventory-production.modifier-effect.activated",
          input.reason,
          activated,
        );
      },
    );
  }

  createBatchRecipe(
    input: CreateBatchRecipeVersion,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-production.batch-recipe.create",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const ids = [
          input.outputInventoryItemId,
          ...input.components.map(({ inventoryItemId }) => inventoryItemId),
        ];
        const [itemCount, latest] = await Promise.all([
          tx.inventoryItem.count({
            where: {
              branchId: input.branchId,
              isActive: true,
              id: { in: ids },
            },
          }),
          tx.batchRecipeVersion.findFirst({
            where: {
              branchId: input.branchId,
              outputInventoryItemId: input.outputInventoryItemId,
            },
            orderBy: { version: "desc" },
            select: { version: true },
          }),
        ]);
        if (itemCount !== ids.length) {
          throw new ConflictException({ code: "INVENTORY_ITEM_UNAVAILABLE" });
        }
        const recipe = await tx.batchRecipeVersion.create({
          data: {
            id: input.batchRecipeVersionId,
            branchId: input.branchId,
            outputInventoryItemId: input.outputInventoryItemId,
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
          select: batchRecipeSelect,
        });
        return this.result(
          recipe.id,
          "inventory-production.batch-recipe.created",
          input.reason,
          recipe,
        );
      },
    );
  }

  activateBatchRecipe(
    recipeId: string,
    input: ActivateBatchRecipeVersion,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.configure", input.branchId);
    return this.idempotent(
      "inventory-production.batch-recipe.activate",
      key,
      { recipeId, ...input },
      principal,
      async (tx) => {
        const recipe = await tx.batchRecipeVersion.findFirst({
          where: {
            id: recipeId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          select: batchRecipeSelect,
        });
        if (!recipe) throw new NotFoundException("Batch recipe not found.");
        this.revision(recipe.revision, input.revision);
        if (recipe.status !== RecipeStatus.DRAFT || !recipe.components.length) {
          throw new ConflictException({
            code: "BATCH_RECIPE_ACTIVATION_INVALID",
          });
        }
        const activated = await tx.batchRecipeVersion.update({
          where: { id: recipe.id },
          data: {
            status: RecipeStatus.ACTIVE,
            revision: { increment: 1 },
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
          select: batchRecipeSelect,
        });
        return this.result(
          activated.id,
          "inventory-production.batch-recipe.activated",
          input.reason,
          activated,
        );
      },
    );
  }

  async preview(input: BatchProductionPreview, principal: AuthPrincipal) {
    this.permission(principal, "inventory.read", input.branchId);
    await this.branch(input.branchId, principal);
    return jsonSafe(await this.resolve(this.prisma, input));
  }

  post(input: PostBatchProduction, key: string, principal: AuthPrincipal) {
    this.permission(principal, "inventory.write", input.branchId);
    if (input.allowNegativeOverride) {
      this.permission(principal, "inventory.manage", input.branchId);
    }
    return this.idempotent(
      "inventory-production.batch.post",
      key,
      input,
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const resolved = await this.resolve(tx, input);
        const ledgerIds = this.matchInputLedgers(
          resolved.inputs,
          input.inputLedgerEntries,
        );
        for (const item of resolved.inputs) {
          await this.assertNonNegative(
            tx,
            input.branchId,
            item.locationId,
            item.inventoryItemId,
            -item.quantityMicros,
            input.allowNegativeOverride,
          );
        }
        await tx.stockLedgerEntry.create({
          data: {
            id: input.outputLedgerEntryId,
            branchId: input.branchId,
            locationId: resolved.outputLocationId,
            inventoryItemId: resolved.outputInventoryItemId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: StockLedgerType.PRODUCTION_OUTPUT,
            quantityDeltaMicros: resolved.outputQuantityMicros,
            sourceType: "BATCH_PRODUCTION",
            sourceId: input.productionId,
            reason: input.reason,
            occurredAt: resolved.occurredAt,
          },
        });
        const production = await tx.batchProduction.create({
          data: {
            id: input.productionId,
            branchId: input.branchId,
            batchRecipeVersionId: resolved.batchRecipeVersionId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            outputInventoryItemId: resolved.outputInventoryItemId,
            outputLocationId: resolved.outputLocationId,
            outputQuantityMicros: resolved.outputQuantityMicros,
            outputLedgerEntryId: input.outputLedgerEntryId,
            negativeStockOverride: input.allowNegativeOverride,
            reason: input.reason,
            occurredAt: resolved.occurredAt,
          },
        });
        for (const item of resolved.inputs) {
          const ledgerEntryId = ledgerIds.get(item.inventoryItemId);
          if (!ledgerEntryId) {
            throw new ConflictException({
              code: "BATCH_LEDGER_MAPPING_INVALID",
            });
          }
          await tx.stockLedgerEntry.create({
            data: {
              id: ledgerEntryId,
              branchId: input.branchId,
              locationId: item.locationId,
              inventoryItemId: item.inventoryItemId,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              type: StockLedgerType.PRODUCTION_INPUT,
              quantityDeltaMicros: -item.quantityMicros,
              sourceType: "BATCH_PRODUCTION",
              sourceId: production.id,
              negativeStockOverride: input.allowNegativeOverride,
              reason: input.reason,
              occurredAt: resolved.occurredAt,
            },
          });
          await tx.batchProductionInput.create({
            data: {
              id: randomUUID(),
              productionId: production.id,
              inventoryItemId: item.inventoryItemId,
              locationId: item.locationId,
              quantityMicros: item.quantityMicros,
              ledgerEntryId,
            },
          });
        }
        const posted = await tx.batchProduction.findUniqueOrThrow({
          where: { id: production.id },
          select: batchProductionSelect,
        });
        return this.result(
          posted.id,
          "inventory-production.batch.posted",
          input.reason,
          publicBatchProduction(posted),
        );
      },
    );
  }

  reverse(
    productionId: string,
    input: ReverseBatchProduction,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "inventory.manage", input.branchId);
    return this.idempotent(
      "inventory-production.batch.reverse",
      key,
      { productionId, ...input },
      principal,
      async (tx) => {
        await this.branch(input.branchId, principal, tx);
        const production = await tx.batchProduction.findFirst({
          where: { id: productionId, branchId: input.branchId },
          include: {
            outputLedgerEntry: true,
            inputs: { include: { ledgerEntry: true } },
            reversal: true,
          },
        });
        if (!production)
          throw new NotFoundException("Batch production not found.");
        this.revision(production.revision, input.productionRevision);
        if (production.reversal) {
          throw new ConflictException({ code: "BATCH_PRODUCTION_REVERSED" });
        }
        const originals = [
          production.outputLedgerEntry,
          ...production.inputs.map(({ ledgerEntry }) => ledgerEntry),
        ];
        const mappings = new Map(
          input.ledgerEntries.map((entry) => [
            entry.originalLedgerEntryId,
            entry.reversalLedgerEntryId,
          ]),
        );
        if (
          mappings.size !== originals.length ||
          originals.some((entry) => !mappings.has(entry.id))
        ) {
          throw new ConflictException({ code: "BATCH_LEDGER_MAPPING_INVALID" });
        }
        await this.assertNonNegative(
          tx,
          input.branchId,
          production.outputLocationId,
          production.outputInventoryItemId,
          -production.outputQuantityMicros,
          input.allowNegativeOverride,
        );
        const reversal = await tx.batchProductionReversal.create({
          data: {
            id: input.reversalId,
            branchId: input.branchId,
            productionId: production.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            reason: input.reason,
          },
        });
        for (const original of originals) {
          const reversalLedgerEntryId = mappings.get(original.id);
          if (!reversalLedgerEntryId) {
            throw new ConflictException({
              code: "BATCH_LEDGER_MAPPING_INVALID",
            });
          }
          await tx.stockLedgerEntry.create({
            data: {
              id: reversalLedgerEntryId,
              branchId: input.branchId,
              locationId: original.locationId,
              inventoryItemId: original.inventoryItemId,
              actorId: principal.userId,
              deviceId: principal.deviceId,
              type: StockLedgerType.REVERSAL,
              quantityDeltaMicros: -original.quantityDeltaMicros,
              sourceType: "BATCH_PRODUCTION_REVERSAL",
              sourceId: reversal.id,
              reason: input.reason,
              occurredAt: new Date(),
            },
          });
          await tx.batchProductionReversalEntry.create({
            data: {
              id: randomUUID(),
              reversalId: reversal.id,
              originalLedgerEntryId: original.id,
              reversalLedgerEntryId,
            },
          });
        }
        await tx.batchProduction.update({
          where: { id: production.id },
          data: { revision: { increment: 1 } },
        });
        const posted = await tx.batchProduction.findUniqueOrThrow({
          where: { id: production.id },
          select: batchProductionSelect,
        });
        return this.result(
          reversal.id,
          "inventory-production.batch.reversed",
          input.reason,
          publicBatchProduction(posted),
        );
      },
    );
  }

  private async resolve(db: Db, input: BatchProductionPreview) {
    const occurredAt = new Date(input.occurredAt);
    const recipe = await db.batchRecipeVersion.findFirst({
      where: {
        id: input.batchRecipeVersionId,
        branchId: input.branchId,
        status: RecipeStatus.ACTIVE,
        effectiveFrom: { lte: occurredAt },
      },
      include: {
        outputInventoryItem: {
          select: { id: true, name: true, isActive: true },
        },
        components: {
          include: {
            inventoryItem: { select: { id: true, name: true, isActive: true } },
          },
          orderBy: { inventoryItemId: "asc" },
        },
      },
    });
    if (!recipe || !recipe.outputInventoryItem.isActive) {
      throw new ConflictException({
        code: "BATCH_RECIPE_CONFIGURATION_MISSING",
      });
    }
    if (recipe.yieldQuantityMicros <= 0n || !recipe.components.length) {
      throw new ConflictException({ code: "BATCH_RECIPE_INVALID" });
    }
    const locationMap = new Map(
      input.inputLocations.map((entry) => [
        entry.inventoryItemId,
        entry.locationId,
      ]),
    );
    if (
      locationMap.size !== recipe.components.length ||
      recipe.components.some(
        (component) => !locationMap.has(component.inventoryItemId),
      )
    ) {
      throw new ConflictException({
        code: "BATCH_INPUT_LOCATION_MAPPING_INVALID",
      });
    }
    const locationIds = [input.outputLocationId, ...locationMap.values()];
    const locations = await db.stockLocation.findMany({
      where: {
        branchId: input.branchId,
        isActive: true,
        id: { in: locationIds },
      },
      select: { id: true },
    });
    if (
      new Set(locations.map(({ id }) => id)).size !== new Set(locationIds).size
    ) {
      throw new ConflictException({ code: "BATCH_LOCATION_UNAVAILABLE" });
    }
    const outputQuantityMicros = BigInt(input.outputQuantityMicros);
    const inputs: ResolvedInput[] = recipe.components.map((component) => {
      if (!component.inventoryItem.isActive) {
        throw new ConflictException({ code: "INVENTORY_ITEM_UNAVAILABLE" });
      }
      const numerator = component.quantityMicros * outputQuantityMicros;
      if (numerator % recipe.yieldQuantityMicros !== 0n) {
        throw new ConflictException({
          code: "BATCH_PRODUCTION_FRACTIONAL_MICRO",
          inventoryItemId: component.inventoryItemId,
        });
      }
      return {
        inventoryItemId: component.inventoryItemId,
        inventoryItemName: component.inventoryItem.name,
        locationId: locationMap.get(component.inventoryItemId)!,
        quantityMicros: numerator / recipe.yieldQuantityMicros,
      };
    });
    return {
      configured: true,
      batchRecipeVersionId: recipe.id,
      batchRecipeVersion: recipe.version,
      outputInventoryItemId: recipe.outputInventoryItemId,
      outputInventoryItemName: recipe.outputInventoryItem.name,
      outputLocationId: input.outputLocationId,
      outputQuantityMicros,
      occurredAt,
      inputs,
    };
  }

  private matchInputLedgers(
    resolved: ResolvedInput[],
    provided: PostBatchProduction["inputLedgerEntries"],
  ) {
    const map = new Map(
      provided.map((entry) => [entry.inventoryItemId, entry.ledgerEntryId]),
    );
    if (
      map.size !== resolved.length ||
      resolved.some((entry) => !map.has(entry.inventoryItemId))
    ) {
      throw new ConflictException({ code: "BATCH_LEDGER_MAPPING_INVALID" });
    }
    return map;
  }

  private async assertNonNegative(
    tx: Tx,
    branchId: string,
    locationId: string,
    inventoryItemId: string,
    delta: bigint,
    override: boolean,
  ) {
    const balance = await tx.stockLedgerEntry.aggregate({
      where: { branchId, locationId, inventoryItemId },
      _sum: { quantityDeltaMicros: true },
    });
    if ((balance._sum.quantityDeltaMicros ?? 0n) + delta >= 0n) return;
    if (!override) {
      throw new ConflictException({
        code: "NEGATIVE_STOCK_POLICY_UNCONFIRMED",
      });
    }
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
              entityType: "inventory-production",
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
              aggregateType: "inventory-production",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: command.branchId,
                inventoryProductionEntityId: result.entityId,
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
        throw new ConflictException({ code: "INVENTORY_PRODUCTION_CONFLICT" });
      }
      throw error;
    }
  }
}
