import type { SyncBootstrapResponse } from "@base-cafe/contracts";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";

function availableAt(
  value: {
    isActive: boolean;
    isAvailable: boolean;
    unavailableFrom: Date | null;
    unavailableTo: Date | null;
  },
  now: Date,
) {
  if (!value.isActive || !value.isAvailable) return false;
  if (!value.unavailableFrom) return true;
  if (value.unavailableFrom > now) return true;
  return Boolean(value.unavailableTo && value.unavailableTo <= now);
}

@Injectable()
export class SyncBootstrapService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async load(
    branchId: string,
    principal: AuthPrincipal,
  ): Promise<SyncBootstrapResponse> {
    for (const permission of ["catalog.read", "orders.read", "shifts.read"]) {
      if (!hasPermission(principal, permission, branchId)) {
        throw new ForbiddenException({
          code: "SYNC_BOOTSTRAP_PERMISSION_DENIED",
          permission,
        });
      }
    }

    const now = new Date();
    const [branch, shift, tables, items, orders, taxProfile] =
      await Promise.all([
        this.prisma.branch.findFirst({
          where: { id: branchId, organizationId: principal.organizationId },
        }),
        this.prisma.staffShift.findFirst({
          where: {
            branchId,
            deviceId: principal.deviceId,
            currentCashierId: principal.userId,
            status: "OPEN",
          },
        }),
        this.prisma.diningTable.findMany({
          where: { branchId, isActive: true, diningArea: { isActive: true } },
          select: {
            id: true,
            diningAreaId: true,
            name: true,
            capacity: true,
            diningArea: { select: { name: true } },
          },
          orderBy: [
            { diningArea: { displayOrder: "asc" } },
            { displayOrder: "asc" },
            { name: "asc" },
          ],
        }),
        this.prisma.menuItem.findMany({
          where: { branchId, isActive: true },
          include: {
            category: true,
            taxClass: true,
            variants: true,
            prices: true,
            modifierGroups: {
              include: { modifierGroup: { include: { modifiers: true } } },
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        this.prisma.order.findMany({
          where: {
            branchId,
            deviceId: principal.deviceId,
            status: { in: ["OPEN", "HELD"] },
          },
          include: {
            table: { select: { name: true } },
            lines: {
              where: { status: "DRAFT" },
              include: { modifiers: { orderBy: { createdAt: "asc" } } },
              orderBy: { createdAt: "asc" },
            },
            preparationTickets: {
              select: {
                id: true,
                stationNameSnapshot: true,
                status: true,
                revision: true,
              },
              orderBy: { queuedAt: "asc" },
            },
            paymentAllocations: {
              where: { payment: { status: "CONFIRMED" } },
              select: { amountMinor: true },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
        this.prisma.taxProfile.findFirst({
          where: {
            branchId,
            status: "ACTIVE",
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          include: { components: { orderBy: { calculationOrder: "asc" } } },
          orderBy: { effectiveFrom: "desc" },
        }),
      ]);

    if (!branch) throw new NotFoundException("Branch not found.");

    const catalog: SyncBootstrapResponse["catalog"] = [];
    for (const item of items) {
      if (!item.taxClass?.isActive || !availableAt(item, now)) continue;
      const modifierGroups = item.modifierGroups
        .filter(({ modifierGroup }) => modifierGroup.isActive)
        .map(({ modifierGroup }) => ({
          id: modifierGroup.id,
          name: modifierGroup.name,
          minimum: modifierGroup.minimum,
          maximum: modifierGroup.maximum,
          freeSelectionCount: modifierGroup.freeSelectionCount,
          modifiers: modifierGroup.modifiers
            .filter((modifier) => availableAt(modifier, now))
            .map((modifier) => ({
              id: modifier.id,
              name: modifier.name,
              priceDeltaMinor: modifier.priceDeltaMinor,
            })),
        }));
      const variants = item.variants.filter((variant) =>
        availableAt(variant, now),
      );
      const selections = variants.length > 0 ? variants : [null];
      for (const variant of selections) {
        const price = item.prices
          .filter(
            (candidate) =>
              candidate.menuVariantId === (variant?.id ?? null) &&
              candidate.currency === branch.currency &&
              candidate.effectiveFrom <= now &&
              (!candidate.effectiveTo || candidate.effectiveTo > now),
          )
          .sort(
            (left, right) =>
              right.effectiveFrom.getTime() - left.effectiveFrom.getTime(),
          )[0];
        if (!price) continue;
        catalog.push({
          menuItemId: item.id,
          variantId: variant?.id ?? null,
          name: item.name,
          variantName: variant?.name ?? null,
          categoryId: item.category.id,
          categoryName: item.category.name,
          imageUrl: item.imageUrl,
          priceMinor: price.amountMinor,
          taxTreatment: item.taxClass.treatment,
          modifierGroups,
        });
      }
    }

    const generatedAt = now.toISOString();
    return {
      generatedAt,
      expiresAt: new Date(now.getTime() + 8 * 60 * 60_000).toISOString(),
      branch: {
        id: branch.id,
        name: branch.name,
        timezone: branch.timezone,
        currency: branch.currency,
      },
      tables: tables.map((table) => ({
        id: table.id,
        areaId: table.diningAreaId,
        areaName: table.diningArea.name,
        name: table.name,
        capacity: table.capacity,
      })),
      shift: shift
        ? {
            id: shift.id,
            revision: shift.revision,
            businessDate: shift.businessDate.toISOString().slice(0, 10),
            currency: shift.currency,
            openingFloatMinor: shift.openingFloatMinor,
          }
        : null,
      taxProfile: taxProfile
        ? {
            id: taxProfile.id,
            name: taxProfile.name,
            priceMode: taxProfile.priceMode,
            roundingMode: taxProfile.roundingMode,
            roundingScope: taxProfile.roundingScope,
            components: taxProfile.components.map((component) => ({
              id: component.id,
              code: component.code,
              receiptLabel: component.receiptLabel,
              ratePpm: component.ratePpm,
              calculationOrder: component.calculationOrder,
            })),
          }
        : null,
      catalog,
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        clientReference: order.clientReference,
        channel: order.channel,
        status: order.status as "OPEN" | "HELD",
        revision: order.revision,
        tableId: order.tableId,
        tableName: order.table?.name ?? null,
        guestCount: order.guestCount,
        pickupReference: order.pickupReference,
        customerReference: order.customerReference,
        tabName: order.tabName,
        note: order.note,
        inputSubtotalMinor: order.inputSubtotalMinor,
        netTotalMinor: order.netTotalMinor,
        taxTotalMinor: order.taxTotalMinor,
        grossTotalMinor: order.grossTotalMinor,
        lines: order.lines.map((line) => ({
          id: line.id,
          menuItemId: line.menuItemId,
          variantId: line.variantId,
          name: line.itemNameSnapshot,
          variantName: line.variantNameSnapshot,
          quantity: line.quantity,
          note: line.note,
          baseUnitPriceMinor: line.baseUnitPriceMinor,
          modifierUnitTotalMinor: line.modifierUnitTotalMinor,
          unitInputAmountMinor: line.unitInputAmountMinor,
          grossAmountMinor: line.grossAmountMinor,
          taxTreatment: line.taxTreatmentSnapshot,
          modifiers: line.modifiers.map((modifier) => ({
            id: modifier.id,
            modifierId: modifier.menuModifierId,
            name: modifier.modifierNameSnapshot,
            quantity: modifier.quantity,
            configuredDeltaMinor: modifier.configuredDeltaMinor,
            chargedDeltaMinor: modifier.chargedDeltaMinor,
          })),
          sent: line.sentAt !== null,
        })),
        tickets: order.preparationTickets.map((ticket) => ({
          id: ticket.id,
          stationName: ticket.stationNameSnapshot,
          status: ticket.status,
          revision: ticket.revision,
        })),
        confirmedPaymentMinor: order.paymentAllocations.reduce(
          (sum, allocation) => sum + allocation.amountMinor,
          0,
        ),
      })),
    };
  }
}
