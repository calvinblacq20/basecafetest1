import type {
  ActivateTaxClassRequest,
  CatalogRevisionCommand,
  CreateTaxClassRequest,
  DeactivateCatalogRequest,
  UpdateMenuItemRequest,
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
import { PrismaService } from "../database/prisma.service.js";
import { availabilityData, availabilityIssue } from "./availability.js";
import { CatalogConfigurationService } from "./catalog-configuration.service.js";
import { itemActivationIssues } from "./catalog-lifecycle.js";

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

@Injectable()
export class CatalogLifecycleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogConfigurationService)
    private readonly mutations: CatalogConfigurationService,
  ) {}

  async createTaxClass(
    input: CreateTaxClassRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.configure", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.tax-class.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const taxClass = await transaction.taxClass.create({
          data: {
            branchId: input.branchId,
            key: input.key,
            label: input.label,
            treatment: input.treatment,
            isActive: false,
          },
        });
        return {
          branchId: input.branchId,
          entityType: "tax_class",
          entityId: taxClass.id,
          eventType: "catalog.tax-class.created",
          response: toJson(taxClass),
          auditReason: input.reason,
        };
      },
    );
  }

  async activateTaxClass(
    taxClassId: string,
    input: ActivateTaxClassRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.configure", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.tax-class.activate",
      idempotencyKey,
      { taxClassId, ...input },
      principal,
      async (transaction) => {
        const taxClass = await transaction.taxClass.findFirst({
          where: { id: taxClassId, branchId: input.branchId },
        });
        if (!taxClass) throw new NotFoundException("Tax class not found.");
        this.assertRevision(taxClass.revision, input.revision);

        const updated = await transaction.taxClass.updateMany({
          where: { id: taxClassId, revision: input.revision },
          data: { isActive: true, revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.taxClass.findUniqueOrThrow({
          where: { id: taxClassId },
        });
        return {
          branchId: input.branchId,
          entityType: "tax_class",
          entityId: taxClassId,
          eventType: "catalog.tax-class.activated",
          response: toJson(response),
          auditReason: input.reason,
        };
      },
    );
  }

  async updateMenuItem(
    menuItemId: string,
    input: UpdateMenuItemRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.menu-item.update",
      idempotencyKey,
      { menuItemId, ...input },
      principal,
      async (transaction) => {
        const item = await transaction.menuItem.findFirst({
          where: { id: menuItemId, branchId: input.branchId },
        });
        if (!item) throw new NotFoundException("Menu item not found.");
        this.assertRevision(item.revision, input.revision);

        if (input.categoryId) {
          const category = await transaction.category.findFirst({
            where: { id: input.categoryId, branchId: input.branchId },
          });
          if (!category) {
            throw new NotFoundException("Category not found in this branch.");
          }
        }

        const stationId =
          input.defaultStationId !== undefined
            ? input.defaultStationId
            : item.defaultStationId;
        const station = stationId
          ? await transaction.station.findFirst({
              where: { id: stationId, branchId: input.branchId },
            })
          : null;
        if (stationId && !station) {
          throw new NotFoundException("Station not found in this branch.");
        }

        const taxClassId =
          input.taxClassId !== undefined ? input.taxClassId : item.taxClassId;
        const taxClass = taxClassId
          ? await transaction.taxClass.findFirst({
              where: { id: taxClassId, branchId: input.branchId },
            })
          : null;
        if (taxClassId && !taxClass) {
          throw new NotFoundException("Tax class not found in this branch.");
        }
        if (item.isActive && (!station?.isActive || !taxClass?.isActive)) {
          throw new BadRequestException(
            "An active menu item must keep an active station and approved tax class.",
          );
        }

        const nextAvailability = {
          isAvailable: input.isAvailable ?? item.isAvailable,
          unavailableFrom: hasOwn(input, "unavailableFrom")
            ? input.unavailableFrom
            : (item.unavailableFrom?.toISOString() ?? null),
          unavailableTo: hasOwn(input, "unavailableTo")
            ? input.unavailableTo
            : (item.unavailableTo?.toISOString() ?? null),
          unavailableReason: hasOwn(input, "unavailableReason")
            ? input.unavailableReason
            : item.unavailableReason,
        };
        const issue = availabilityIssue(nextAvailability);
        if (issue) throw new BadRequestException(issue);

        const result = await transaction.menuItem.updateMany({
          where: { id: menuItemId, revision: input.revision },
          data: {
            ...(input.categoryId !== undefined && {
              categoryId: input.categoryId,
            }),
            ...(input.defaultStationId !== undefined && {
              defaultStationId: input.defaultStationId,
            }),
            ...(input.taxClassId !== undefined && {
              taxClassId: input.taxClassId,
            }),
            ...(input.name !== undefined && { name: input.name }),
            ...(input.shortName !== undefined && {
              shortName: input.shortName,
            }),
            ...(input.description !== undefined && {
              description: input.description,
            }),
            ...(input.sku !== undefined && { sku: input.sku }),
            ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
            ...availabilityData(nextAvailability),
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) this.throwRevisionConflict();
        const response = await transaction.menuItem.findUniqueOrThrow({
          where: { id: menuItemId },
        });
        return {
          branchId: input.branchId,
          entityType: "menu_item",
          entityId: menuItemId,
          eventType: "catalog.menu-item.updated",
          response: toJson(response),
          auditReason: input.reason,
        };
      },
    );
  }

  async activateMenuItem(
    menuItemId: string,
    input: CatalogRevisionCommand,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.menu-item.activate",
      idempotencyKey,
      { menuItemId, ...input },
      principal,
      async (transaction) => {
        const item = await transaction.menuItem.findFirst({
          where: { id: menuItemId, branchId: input.branchId },
          include: { defaultStation: true, taxClass: true },
        });
        if (!item) throw new NotFoundException("Menu item not found.");
        this.assertRevision(item.revision, input.revision);
        const now = new Date();
        const price = await transaction.menuPrice.findFirst({
          where: {
            branchId: input.branchId,
            menuItemId,
            menuVariantId: null,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true },
        });
        const issues = itemActivationIssues({
          stationConfigured: item.defaultStation?.isActive === true,
          taxClassActive: item.taxClass?.isActive === true,
          effectivePrice: Boolean(price),
        });
        if (issues.length) {
          throw new BadRequestException({
            code: "CATALOG_CONFIGURATION_INCOMPLETE",
            message: "The menu item cannot be activated.",
            issues,
          });
        }
        return this.setItemActive(
          transaction,
          menuItemId,
          input,
          true,
          "catalog.menu-item.activated",
        );
      },
    );
  }

  async deactivateMenuItem(
    menuItemId: string,
    input: DeactivateCatalogRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.menu-item.deactivate",
      idempotencyKey,
      { menuItemId, ...input },
      principal,
      async (transaction) => {
        const item = await transaction.menuItem.findFirst({
          where: { id: menuItemId, branchId: input.branchId },
        });
        if (!item) throw new NotFoundException("Menu item not found.");
        this.assertRevision(item.revision, input.revision);
        const result = await this.setItemActive(
          transaction,
          menuItemId,
          input,
          false,
          "catalog.menu-item.deactivated",
        );
        return result;
      },
    );
  }

  async activateVariant(
    menuItemId: string,
    variantId: string,
    input: CatalogRevisionCommand,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "catalog.write", input.branchId);
    return this.mutations.executeIdempotent(
      "catalog.menu-variant.activate",
      idempotencyKey,
      { menuItemId, variantId, ...input },
      principal,
      async (transaction) => {
        const variant = await transaction.menuVariant.findFirst({
          where: {
            id: variantId,
            menuItemId,
            menuItem: { branchId: input.branchId },
          },
          include: { menuItem: true },
        });
        if (!variant) throw new NotFoundException("Menu variant not found.");
        this.assertRevision(variant.revision, input.revision);
        if (!variant.menuItem.isActive) {
          throw new BadRequestException(
            "Activate the parent menu item before activating a variant.",
          );
        }
        const now = new Date();
        const price = await transaction.menuPrice.findFirst({
          where: {
            branchId: input.branchId,
            menuItemId,
            menuVariantId: variantId,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true },
        });
        if (!price) {
          throw new BadRequestException(
            "An active variant requires its own effective price.",
          );
        }
        const updated = await transaction.menuVariant.updateMany({
          where: { id: variantId, revision: input.revision },
          data: { isActive: true, revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.menuVariant.findUniqueOrThrow({
          where: { id: variantId },
        });
        return {
          branchId: input.branchId,
          entityType: "menu_variant",
          entityId: variantId,
          eventType: "catalog.menu-variant.activated",
          response: toJson(response),
          auditReason: input.reason,
        };
      },
    );
  }

  private async setItemActive(
    transaction: Prisma.TransactionClient,
    menuItemId: string,
    input: CatalogRevisionCommand,
    isActive: boolean,
    eventType: string,
  ) {
    const updated = await transaction.menuItem.updateMany({
      where: { id: menuItemId, revision: input.revision },
      data: { isActive, revision: { increment: 1 } },
    });
    if (updated.count !== 1) this.throwRevisionConflict();
    const response = await transaction.menuItem.findUniqueOrThrow({
      where: { id: menuItemId },
    });
    return {
      branchId: input.branchId,
      entityType: "menu_item",
      entityId: menuItemId,
      eventType,
      response: toJson(response),
      auditReason: input.reason,
    };
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) this.throwRevisionConflict();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The catalog entry changed since it was read. Refresh and retry.",
    );
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

  private async assertBranch(
    transaction: Prisma.TransactionClient,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await transaction.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
  }
}
