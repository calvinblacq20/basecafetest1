import type {
  AttachModifierGroupRequest,
  CreateMenuItemRequest,
  CreateMenuPriceRequest,
  CreateMenuVariantRequest,
  CreateModifierGroupRequest,
  CreateStationRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  availabilityData,
  availabilityIssue,
  type AvailabilityInput,
} from "./availability.js";

export type CatalogMutationResult = Readonly<{
  branchId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  auditReason?: string;
  auditMetadata?: Prisma.InputJsonObject;
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function publicPrice<T extends { createdById: string }>(price: T) {
  const { createdById, ...response } = price;
  void createdById;
  return response;
}

@Injectable()
export class CatalogConfigurationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listStations(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "catalog.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.station.findMany({
      where: { branchId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  }

  async listTaxClasses(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "tax.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.taxClass.findMany({
      where: { branchId },
      orderBy: [{ treatment: "asc" }, { label: "asc" }],
    });
  }

  async createStation(
    input: CreateStationRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.executeIdempotent(
      "catalog.station.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const station = await transaction.station.create({
          data: {
            branchId: input.branchId,
            externalKey: input.externalKey ?? null,
            name: input.name,
            kind: input.kind,
          },
        });
        return {
          branchId: input.branchId,
          entityType: "station",
          entityId: station.id,
          eventType: "catalog.station.created",
          response: toJson(station),
          auditReason: input.reason,
        };
      },
    );
  }

  async listMenuItems(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "catalog.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const items = await this.prisma.menuItem.findMany({
      where: { branchId },
      include: {
        category: true,
        defaultStation: true,
        taxClass: true,
        variants: {
          include: { prices: { orderBy: { effectiveFrom: "desc" } } },
          orderBy: { name: "asc" },
        },
        prices: {
          where: { menuVariantId: null },
          orderBy: { effectiveFrom: "desc" },
        },
        modifierGroups: {
          include: {
            modifierGroup: { include: { modifiers: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
    return items.map((item) => ({
      ...item,
      prices: item.prices.map(publicPrice),
      variants: item.variants.map((variant) => ({
        ...variant,
        prices: variant.prices.map(publicPrice),
      })),
    }));
  }

  async createMenuItem(
    input: CreateMenuItemRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    this.assertAvailability(input);
    if (input.isActive) {
      throw new BadRequestException(
        "Create the item inactive, add an effective price, station and approved tax class, then activate it with optimistic concurrency.",
      );
    }

    return this.executeIdempotent(
      "catalog.menu-item.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const category = await transaction.category.findFirst({
          where: { id: input.categoryId, branchId: input.branchId },
        });
        if (!category) {
          throw new NotFoundException("Category not found in this branch.");
        }
        await this.assertOptionalStation(
          transaction,
          input.defaultStationId,
          input.branchId,
        );
        if (input.taxClassId) {
          const taxClass = await transaction.taxClass.findFirst({
            where: { id: input.taxClassId, branchId: input.branchId },
          });
          if (!taxClass) {
            throw new NotFoundException("Tax class not found in this branch.");
          }
        }

        const item = await transaction.menuItem.create({
          data: {
            branchId: input.branchId,
            externalKey: input.externalKey ?? null,
            categoryId: input.categoryId,
            defaultStationId: input.defaultStationId ?? null,
            taxClassId: input.taxClassId ?? null,
            name: input.name,
            shortName: input.shortName ?? null,
            description: input.description ?? null,
            sku: input.sku ?? null,
            imageUrl: input.imageUrl ?? null,
            isActive: false,
            ...availabilityData(input),
          },
        });
        return {
          branchId: input.branchId,
          entityType: "menu_item",
          entityId: item.id,
          eventType: "catalog.menu-item.created",
          response: toJson(item),
          auditReason: input.reason,
        };
      },
    );
  }

  async createVariant(
    menuItemId: string,
    input: CreateMenuVariantRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    this.assertAvailability(input);
    if (input.isActive) {
      throw new BadRequestException(
        "Create the variant inactive, add its effective price, then activate it.",
      );
    }
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId: input.branchId },
    });
    if (!item) {
      throw new NotFoundException("Menu item not found.");
    }

    return this.executeIdempotent(
      "catalog.menu-variant.create",
      idempotencyKey,
      { menuItemId, ...input },
      principal,
      async (transaction) => {
        const variant = await transaction.menuVariant.create({
          data: {
            menuItemId,
            externalKey: input.externalKey ?? null,
            name: input.name,
            sku: input.sku ?? null,
            isActive: false,
            ...availabilityData(input),
          },
        });
        return {
          branchId: item.branchId,
          entityType: "menu_variant",
          entityId: variant.id,
          eventType: "catalog.menu-variant.created",
          response: toJson(variant),
          auditReason: input.reason,
        };
      },
    );
  }

  async listModifierGroups(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "catalog.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.modifierGroup.findMany({
      where: { branchId },
      include: { modifiers: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    });
  }

  async createModifierGroup(
    input: CreateModifierGroupRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    const normalizedNames = input.modifiers.map((modifier) =>
      modifier.name.toLocaleLowerCase("en"),
    );
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      throw new BadRequestException(
        "Modifier names must be unique in a group.",
      );
    }
    input.modifiers.forEach((modifier) => this.assertAvailability(modifier));

    return this.executeIdempotent(
      "catalog.modifier-group.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        for (const modifier of input.modifiers) {
          await this.assertOptionalStation(
            transaction,
            modifier.stationId,
            input.branchId,
          );
        }
        const group = await transaction.modifierGroup.create({
          data: {
            branchId: input.branchId,
            name: input.name,
            minimum: input.minimum,
            maximum: input.maximum,
            isRequired: input.isRequired,
            freeSelectionCount: input.freeSelectionCount,
            modifiers: {
              create: input.modifiers.map((modifier) => ({
                name: modifier.name,
                stationId: modifier.stationId ?? null,
                priceDeltaMinor: modifier.priceDeltaMinor,
                ...availabilityData(modifier),
              })),
            },
          },
          include: { modifiers: true },
        });
        return {
          branchId: input.branchId,
          entityType: "modifier_group",
          entityId: group.id,
          eventType: "catalog.modifier-group.created",
          response: toJson(group),
          auditReason: input.reason,
        };
      },
    );
  }

  async attachModifierGroup(
    menuItemId: string,
    modifierGroupId: string,
    input: AttachModifierGroupRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.executeIdempotent(
      "catalog.menu-item.modifier-group.attach",
      idempotencyKey,
      { menuItemId, modifierGroupId, ...input },
      principal,
      async (transaction) => {
        const [item, group] = await Promise.all([
          transaction.menuItem.findFirst({
            where: { id: menuItemId, branchId: input.branchId },
          }),
          transaction.modifierGroup.findFirst({
            where: { id: modifierGroupId, branchId: input.branchId },
          }),
        ]);
        if (!item || !group) {
          throw new NotFoundException(
            "Menu item or modifier group not found in this branch.",
          );
        }
        const link = await transaction.menuItemModifierGroup.create({
          data: { menuItemId, modifierGroupId, sortOrder: input.sortOrder },
        });
        return {
          branchId: input.branchId,
          entityType: "menu_item_modifier_group",
          entityId: `${menuItemId}:${modifierGroupId}`,
          eventType: "catalog.menu-item.modifier-group.attached",
          response: toJson(link),
          auditReason: input.reason,
        };
      },
    );
  }

  async createPrice(
    input: CreateMenuPriceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.executeIdempotent(
      "catalog.price.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        const item = await transaction.menuItem.findFirst({
          where: { id: input.menuItemId, branchId: input.branchId },
        });
        if (!item) {
          throw new NotFoundException("Menu item not found in this branch.");
        }
        if (input.menuVariantId) {
          const variant = await transaction.menuVariant.findFirst({
            where: { id: input.menuVariantId, menuItemId: input.menuItemId },
          });
          if (!variant) {
            throw new NotFoundException("Variant does not belong to the item.");
          }
        }

        const effectiveFrom = new Date(input.effectiveFrom);
        const effectiveTo = input.effectiveTo
          ? new Date(input.effectiveTo)
          : null;
        const overlap = await transaction.menuPrice.findFirst({
          where: {
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
            ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
        });
        if (overlap) {
          throw new ConflictException(
            "The effective price overlaps an existing price interval.",
          );
        }

        const price = await transaction.menuPrice.create({
          data: {
            branchId: input.branchId,
            menuItemId: input.menuItemId,
            menuVariantId: input.menuVariantId ?? null,
            createdById: principal.userId,
            amountMinor: input.amountMinor,
            effectiveFrom,
            effectiveTo,
          },
        });
        return {
          branchId: input.branchId,
          entityType: "menu_price",
          entityId: price.id,
          eventType: "catalog.price.created",
          response: toJson(publicPrice(price)),
          auditReason: input.reason,
        };
      },
    );
  }

  async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (
      transaction: Prisma.TransactionClient,
    ) => Promise<CatalogMutationResult>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new ConflictException(
          "The idempotency key was already used with a different request.",
        );
      }
      return existing.responseBody;
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const result = await work(transaction);
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: result.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: result.entityType,
              entityId: result.entityId,
              reason: result.auditReason,
              metadata: {
                deviceId: principal.deviceId,
                ...(result.auditMetadata ?? {}),
              },
            },
          });
          await transaction.outboxEvent.create({
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
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
              requestHash: hash,
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
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "The catalog resource or idempotency key already exists.",
        );
      }
      throw error;
    }
  }

  private assertPermission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId)) {
      throw new ForbiddenException(
        "The user lacks permission for the requested branch.",
      );
    }
  }

  private assertAvailability(input: AvailabilityInput) {
    const issue = availabilityIssue(input);
    if (issue) {
      throw new BadRequestException(issue);
    }
  }

  private async assertBranch(
    client: Prisma.TransactionClient | PrismaService,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new NotFoundException("Branch not found.");
    }
  }

  private async assertOptionalStation(
    transaction: Prisma.TransactionClient,
    stationId: string | null | undefined,
    branchId: string,
  ) {
    if (!stationId) return;
    const station = await transaction.station.findFirst({
      where: { id: stationId, branchId },
    });
    if (!station) {
      throw new NotFoundException("Station not found in this branch.");
    }
  }
}
