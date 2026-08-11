import type {
  AddOrderLineRequest,
  CreateOrderRequest,
  OrderListQuery,
  OrderRevisionRequest,
  RemoveOrderLineRequest,
  ReplaceOrderLineRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  OrderEventType,
  OrderLineStatus,
  OrderStatus,
  Prisma,
  TaxProfileStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { InventoryAvailabilityService } from "../inventory-availability/inventory-availability.service.js";
import { CustomerPiiCryptoService } from "../privacy/customer-pii-crypto.service.js";
import { PrivacyAccessService } from "../privacy/privacy-access.service.js";
import { calculateOrder } from "./order-calculator.js";
import {
  assignFreeSelections,
  officialOrderNumber,
  orderTransitionAllowed,
} from "./order-policy.js";

type Tx = Prisma.TransactionClient;
type MutationResult = Readonly<{
  branchId: string;
  orderId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
  metadata?: Prisma.InputJsonObject;
}>;

const orderInclude = {
  table: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  assignedServer: { select: { id: true, displayName: true } },
  lines: {
    include: { modifiers: true, taxComponents: true },
    orderBy: { createdAt: "asc" as const },
  },
  events: {
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { occurredAt: "asc" as const },
  },
  tableConflicts: true,
  tableMovements: {
    include: {
      fromTable: { select: { id: true, name: true } },
      toTable: { select: { id: true, name: true } },
      actor: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  responsibilityTransfers: {
    include: {
      fromUser: { select: { id: true, displayName: true } },
      toUser: { select: { id: true, displayName: true } },
      actor: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  mergesAsTarget: {
    include: {
      source: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          inputSubtotalMinor: true,
          netTotalMinor: true,
          taxTotalMinor: true,
          grossTotalMinor: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  mergeAsSource: {
    include: { target: { select: { id: true, orderNumber: true } } },
  },
  splitsAsSource: {
    include: {
      child: { select: { id: true, orderNumber: true } },
      lines: true,
    },
  },
  parentSplit: {
    include: {
      source: { select: { id: true, orderNumber: true } },
      lines: true,
    },
  },
  customerContact: true,
} as const;

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function dateOnly(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function fail(
  code: string,
  message: string,
  Kind:
    typeof ConflictException | typeof BadRequestException = ConflictException,
): never {
  throw new Kind({ code, message });
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(InventoryAvailabilityService)
    private readonly inventoryAvailability?: InventoryAvailabilityService,
    @Optional()
    @Inject(CustomerPiiCryptoService)
    private readonly customerPii?: CustomerPiiCryptoService,
    @Optional()
    @Inject(PrivacyAccessService)
    private readonly privacyAccess?: PrivacyAccessService,
  ) {}

  async list(
    branchId: string,
    query: OrderListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.read", branchId);
    await this.branch(this.prisma, branchId, principal.organizationId);
    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        ...(query.status && { status: query.status }),
        ...(query.channel && { channel: query.channel }),
        ...(query.businessDate && {
          businessDate: dateOnly(new Date(query.businessDate)),
        }),
        ...(query.orderNumber && { orderNumber: query.orderNumber }),
        ...(query.clientReference && {
          clientReference: query.clientReference,
        }),
        ...(query.tableId && { tableId: query.tableId }),
      },
      include: {
        table: { select: { id: true, name: true } },
        assignedServer: { select: { id: true, displayName: true } },
        _count: {
          select: { lines: { where: { status: OrderLineStatus.DRAFT } } },
        },
      },
      orderBy: [{ businessDate: "desc" }, { orderSequence: "desc" }],
      take: query.limit,
    });
    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      clientReference: order.clientReference,
      channel: order.channel,
      status: order.status,
      revision: order.revision,
      businessDate: order.businessDate.toISOString().slice(0, 10),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      table: order.table,
      assignedServer: order.assignedServer,
      guestCount: order.guestCount,
      pickupReference: order.pickupReference,
      customerReference: order.customerReference,
      tabName: order.tabName,
      activeLineCount: order._count.lines,
      grossTotalMinor: order.grossTotalMinor,
    }));
  }

  async get(orderId: string, branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "orders.read", branchId);
    const order = await this.find(
      this.prisma,
      orderId,
      branchId,
      principal.organizationId,
    );
    const canReadCustomerData = hasPermission(
      principal,
      "orders.customer-data.read",
      branchId,
    );
    const visible = this.visibleOrder(
      order,
      canReadCustomerData,
      principal.organizationId,
    );
    if (canReadCustomerData && this.hasProtectedContact(order))
      await this.privacyAccess?.record(principal, {
        accessType: "ORDER_VIEW",
        resourceType: "ORDER",
        resourceId: order.id,
        customerId: order.customerContact?.customerId,
        fields: ["customerPhone", "deliveryDirections"],
        reason: "Authorized operational order-detail access.",
      });
    const composed = order.mergesAsTarget.map(({ source }) => source);
    return {
      ...visible,
      compositionTotals: [order, ...composed].reduce(
        (sum, value) => ({
          inputSubtotalMinor: sum.inputSubtotalMinor + value.inputSubtotalMinor,
          netTotalMinor: sum.netTotalMinor + value.netTotalMinor,
          taxTotalMinor: sum.taxTotalMinor + value.taxTotalMinor,
          grossTotalMinor: sum.grossTotalMinor + value.grossTotalMinor,
        }),
        {
          inputSubtotalMinor: 0,
          netTotalMinor: 0,
          taxTotalMinor: 0,
          grossTotalMinor: 0,
        },
      ),
    };
  }

  async create(
    input: CreateOrderRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.create", input.branchId);
    const replay = await this.prisma.order.findFirst({
      where: {
        deviceId: principal.deviceId,
        clientReference: input.clientReference,
        branchId: input.branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: orderInclude,
    });
    if (replay) {
      if (replay.id !== input.orderId)
        fail(
          "CLIENT_REFERENCE_CONFLICT",
          "The provisional reference already belongs to another order.",
        );
      return this.visibleOrder(replay, false, principal.organizationId);
    }
    return this.idempotent(
      "orders.create",
      key,
      input,
      principal,
      async (tx) => {
        const shift = await tx.staffShift.findFirst({
          where: {
            id: input.shiftId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (
          !shift ||
          shift.status !== "OPEN" ||
          shift.deviceId !== principal.deviceId ||
          shift.currentCashierId !== principal.userId
        )
          fail(
            "ORDER_SHIFT_NOT_OPEN",
            "The order requires the current open shift on this device.",
          );

        let customerId: string | null = null;
        if (input.customerId) {
          const customer = await tx.customerProfile.findFirst({
            where: {
              id: input.customerId,
              organizationId: principal.organizationId,
            },
          });
          if (!customer)
            fail("CUSTOMER_NOT_FOUND", "The customer profile was not found.");
          if (customer.status !== "ACTIVE")
            fail(
              "CUSTOMER_CONTACT_RESTRICTED",
              "The customer profile cannot be reused for operational contact.",
            );
          customerId = customer.id;
        }

        const protectedContact =
          input.customerPhone || input.deliveryDirections
            ? this.customerPii?.protect(
                {
                  phone: input.customerPhone ?? null,
                  deliveryDirections: input.deliveryDirections ?? null,
                },
                {
                  organizationId: principal.organizationId,
                  resourceType: "order-contact",
                  resourceId: input.orderId,
                },
              )
            : null;
        if (
          (input.customerPhone || input.deliveryDirections) &&
          !protectedContact
        )
          fail(
            "CUSTOMER_PII_CONFIGURATION_MISSING",
            "Customer contact encryption is not configured.",
          );

        if (input.tableId) {
          const table = await tx.diningTable.findFirst({
            where: {
              id: input.tableId,
              branchId: input.branchId,
              isActive: true,
            },
          });
          if (!table)
            fail(
              "CATALOG_ENTRY_UNAVAILABLE",
              "The selected table is inactive or outside the branch.",
              BadRequestException,
            );
        }
        const occupied = input.tableId
          ? await tx.order.findMany({
              where: {
                tableId: input.tableId,
                status: { in: ["OPEN", "HELD"] },
              },
              select: { id: true },
            })
          : [];
        if (occupied.length && !input.allowTableConflict)
          fail("TABLE_OCCUPIED", "The table already has an active order.");
        if (
          occupied.length &&
          !hasPermission(principal, "orders.manage", input.branchId)
        )
          throw new ForbiddenException({
            code: "TABLE_OCCUPIED",
            message: "orders.manage is required to override table occupancy.",
          });

        const sequence = await tx.branchOrderSequence.upsert({
          where: {
            branchId_businessDate: {
              branchId: input.branchId,
              businessDate: shift.businessDate,
            },
          },
          create: {
            branchId: input.branchId,
            businessDate: shift.businessDate,
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
        });
        const order = await tx.order.create({
          data: {
            id: input.orderId,
            branchId: input.branchId,
            shiftId: shift.id,
            deviceId: shift.deviceId,
            createdById: shift.currentCashierId,
            assignedServerId: shift.currentCashierId,
            businessDate: shift.businessDate,
            currency: shift.currency,
            orderSequence: sequence.lastValue,
            orderNumber: officialOrderNumber(
              shift.businessDate,
              sequence.lastValue,
            ),
            clientReference: input.clientReference,
            channel: input.channel,
            tableId: input.tableId ?? null,
            guestCount: input.guestCount ?? null,
            pickupReference: input.pickupReference ?? null,
            customerReference: input.customerReference ?? null,
            customerPhone: null,
            deliveryDirections: null,
            tabName: input.tabName ?? null,
            note: input.note ?? null,
            tableConflictOverride: occupied.length > 0,
          },
        });
        if (protectedContact) {
          await tx.orderCustomerContact.create({
            data: {
              orderId: order.id,
              organizationId: principal.organizationId,
              branchId: input.branchId,
              customerId,
              piiCiphertext: protectedContact.ciphertext,
              piiIv: protectedContact.iv,
              piiAuthTag: protectedContact.authTag,
              piiKeyVersion: protectedContact.keyVersion,
              phoneBlindIndex: this.customerPii?.phoneBlindIndex(
                input.customerPhone,
              ),
            },
          });
        }
        await this.event(
          tx,
          order.id,
          principal,
          OrderEventType.CREATED,
          1,
          input.reason,
        );
        for (const conflict of occupied) {
          await tx.orderTableConflict.create({
            data: {
              orderId: order.id,
              tableId: input.tableId!,
              conflictingOrderId: conflict.id,
              approvedById: principal.userId,
              reason: input.reason,
            },
          });
        }
        if (occupied.length)
          await this.event(
            tx,
            order.id,
            principal,
            OrderEventType.TABLE_CONFLICT_OVERRIDDEN,
            1,
            input.reason,
            { conflictingOrderIds: occupied.map(({ id }) => id) },
          );
        const response = this.visibleOrder(
          await this.find(
            tx,
            order.id,
            input.branchId,
            principal.organizationId,
          ),
          false,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          order.id,
          "order.created",
          response,
          input.reason,
          {
            orderNumber: order.orderNumber,
            tableConflictCount: occupied.length,
          },
        );
      },
    );
  }

  hold(
    orderId: string,
    input: OrderRevisionRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      orderId,
      input,
      key,
      principal,
      OrderStatus.HELD,
      OrderEventType.HELD,
      "order.held",
    );
  }

  resume(
    orderId: string,
    input: OrderRevisionRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      orderId,
      input,
      key,
      principal,
      OrderStatus.OPEN,
      OrderEventType.RESUMED,
      "order.resumed",
    );
  }

  cancel(
    orderId: string,
    input: OrderRevisionRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transition(
      orderId,
      input,
      key,
      principal,
      OrderStatus.CANCELLED,
      OrderEventType.CANCELLED,
      "order.cancelled",
    );
  }

  async addLine(
    orderId: string,
    input: AddOrderLineRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.write", input.branchId);
    return this.idempotent(
      "orders.lines.add",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await this.mutableOrder(
          tx,
          orderId,
          input.branchId,
          input.orderRevision,
          principal,
        );
        if (input.replacesCancelledLineId) {
          if (!hasPermission(principal, "orders.manage", input.branchId))
            throw new ForbiddenException(
              "orders.manage is required to replace a cancelled sent line.",
            );
          const cancelledSource = await tx.orderLine.findFirst({
            where: {
              id: input.replacesCancelledLineId,
              orderId,
              status: OrderLineStatus.CANCELLED,
              sentCancellation: { isNot: null },
            },
            select: { id: true },
          });
          if (!cancelledSource)
            fail(
              "SENT_REPLACEMENT_SOURCE_INVALID",
              "The replacement source must be an explicitly cancelled sent line on this order.",
            );
        }
        const profile = await this.taxProfile(tx, order);
        const snapshot = await this.lineSnapshot(
          tx,
          order,
          input,
          input.lineId,
          input.replacesCancelledLineId ?? null,
          principal.userId,
        );
        await tx.orderLine.create({ data: snapshot });
        const revision = await this.recalculate(
          tx,
          order,
          profile,
          input.orderRevision,
        );
        await this.event(
          tx,
          orderId,
          principal,
          OrderEventType.LINE_ADDED,
          revision,
          input.reason,
          {
            lineId: input.lineId,
            ...(input.replacesCancelledLineId && {
              replacesCancelledLineId: input.replacesCancelledLineId,
            }),
          },
        );
        const response = this.visibleOrder(
          await this.find(
            tx,
            orderId,
            input.branchId,
            principal.organizationId,
          ),
          false,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          orderId,
          "order.line_added",
          response,
          input.reason,
          {
            lineId: input.lineId,
            ...(input.replacesCancelledLineId && {
              replacesCancelledLineId: input.replacesCancelledLineId,
            }),
            revision,
          },
        );
      },
    );
  }

  async replaceLine(
    orderId: string,
    lineId: string,
    input: ReplaceOrderLineRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.write", input.branchId);
    return this.idempotent(
      "orders.lines.replace",
      key,
      { orderId, lineId, ...input },
      principal,
      async (tx) => {
        const order = await this.mutableOrder(
          tx,
          orderId,
          input.branchId,
          input.orderRevision,
          principal,
        );
        const original = await tx.orderLine.findFirst({
          where: { id: lineId, orderId, status: OrderLineStatus.DRAFT },
        });
        if (!original)
          fail(
            "CATALOG_ENTRY_UNAVAILABLE",
            "The active line was not found.",
            BadRequestException,
          );
        if (original.sentAt !== null)
          fail(
            "SENT_LINE_IMMUTABLE",
            "A sent line must be corrected through an approved cancellation and a new line.",
          );
        const profile = await this.taxProfile(tx, order);
        const snapshot = await this.lineSnapshot(
          tx,
          order,
          input,
          input.replacementLineId,
          lineId,
          principal.userId,
        );
        await tx.orderLine.update({
          where: { id: lineId },
          data: { status: OrderLineStatus.REPLACED, endedAt: new Date() },
        });
        await tx.orderLine.create({ data: snapshot });
        const revision = await this.recalculate(
          tx,
          order,
          profile,
          input.orderRevision,
        );
        await this.event(
          tx,
          orderId,
          principal,
          OrderEventType.LINE_REPLACED,
          revision,
          input.reason,
          { lineId, replacementLineId: input.replacementLineId },
        );
        const response = this.visibleOrder(
          await this.find(
            tx,
            orderId,
            input.branchId,
            principal.organizationId,
          ),
          false,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          orderId,
          "order.line_replaced",
          response,
          input.reason,
          { lineId, replacementLineId: input.replacementLineId, revision },
        );
      },
    );
  }

  async removeLine(
    orderId: string,
    lineId: string,
    input: RemoveOrderLineRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.write", input.branchId);
    return this.idempotent(
      "orders.lines.remove",
      key,
      { orderId, lineId, ...input },
      principal,
      async (tx) => {
        const order = await this.mutableOrder(
          tx,
          orderId,
          input.branchId,
          input.orderRevision,
          principal,
        );
        const updated = await tx.orderLine.updateMany({
          where: {
            id: lineId,
            orderId,
            status: OrderLineStatus.DRAFT,
            sentAt: null,
          },
          data: { status: OrderLineStatus.REMOVED, endedAt: new Date() },
        });
        if (updated.count !== 1)
          fail(
            "CATALOG_ENTRY_UNAVAILABLE",
            "The active line was not found.",
            BadRequestException,
          );
        const profile = order.taxProfileId
          ? await this.taxProfile(tx, order)
          : null;
        const revision = await this.recalculate(
          tx,
          order,
          profile,
          input.orderRevision,
        );
        await this.event(
          tx,
          orderId,
          principal,
          OrderEventType.LINE_REMOVED,
          revision,
          input.reason,
          { lineId },
        );
        const response = this.visibleOrder(
          await this.find(
            tx,
            orderId,
            input.branchId,
            principal.organizationId,
          ),
          false,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          orderId,
          "order.line_removed",
          response,
          input.reason,
          { lineId, revision },
        );
      },
    );
  }

  private async transition(
    orderId: string,
    input: OrderRevisionRequest,
    key: string,
    principal: AuthPrincipal,
    target: OrderStatus,
    eventType: OrderEventType,
    outboxType: string,
  ) {
    this.permission(principal, "orders.write", input.branchId);
    return this.idempotent(
      `orders.${target.toLowerCase()}`,
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await this.find(
          tx,
          orderId,
          input.branchId,
          principal.organizationId,
        );
        if (order.revision !== input.revision)
          fail("STALE_REVISION", "The order changed since it was read.");
        if (target === OrderStatus.CANCELLED && order.mergesAsTarget.length > 0)
          fail(
            "ORDER_COMPOSITION_ACTIVE",
            "A composed order requires a dedicated group cancellation workflow.",
          );
        if (!orderTransitionAllowed(order.status, target))
          fail(
            "ORDER_STATE_INVALID",
            `The order cannot transition from ${order.status} to ${target}.`,
          );
        const now = new Date();
        const updated = await tx.order.updateMany({
          where: {
            id: orderId,
            revision: input.revision,
            status: order.status,
          },
          data: {
            status: target,
            revision: { increment: 1 },
            heldAt: target === OrderStatus.HELD ? now : null,
            ...(target === OrderStatus.CANCELLED && { cancelledAt: now }),
          },
        });
        if (updated.count !== 1)
          fail("STALE_REVISION", "The order changed since it was read.");
        await this.event(
          tx,
          orderId,
          principal,
          eventType,
          input.revision + 1,
          input.reason,
        );
        const response = this.visibleOrder(
          await this.find(
            tx,
            orderId,
            input.branchId,
            principal.organizationId,
          ),
          false,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          orderId,
          outboxType,
          response,
          input.reason,
          { revision: input.revision + 1 },
        );
      },
    );
  }

  private async lineSnapshot(
    tx: Tx,
    order: { id: string; branchId: string; currency: string },
    input: AddOrderLineRequest | ReplaceOrderLineRequest,
    lineId: string,
    replacesLineId: string | null,
    actorId: string,
  ): Promise<Prisma.OrderLineCreateInput> {
    const item = await tx.menuItem.findFirst({
      where: { id: input.menuItemId, branchId: order.branchId },
      include: {
        category: true,
        defaultStation: true,
        taxClass: true,
        variants: true,
        modifierGroups: {
          include: {
            modifierGroup: {
              include: { modifiers: { include: { station: true } } },
            },
          },
        },
      },
    });
    if (
      !item ||
      !item.isActive ||
      !item.isAvailable ||
      !item.taxClass?.isActive
    )
      fail(
        "CATALOG_ENTRY_UNAVAILABLE",
        "The item or tax class is inactive or unavailable.",
        BadRequestException,
      );
    const variant = input.variantId
      ? item.variants.find(({ id }) => id === input.variantId)
      : null;
    if (
      input.variantId &&
      (!variant || !variant.isActive || !variant.isAvailable)
    )
      fail(
        "CATALOG_ENTRY_UNAVAILABLE",
        "The variant is inactive, unavailable, or belongs to another item.",
        BadRequestException,
      );
    const now = new Date();
    const price = await tx.menuPrice.findFirst({
      where: {
        branchId: order.branchId,
        menuItemId: item.id,
        menuVariantId: input.variantId ?? null,
        currency: order.currency,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!price)
      fail(
        "PRICE_CONFIGURATION_MISSING",
        "No exact effective price exists for the selected item or variant.",
      );

    const selectedByGroup = new Map<
      string,
      Array<{
        selection: (typeof input.modifiers)[number];
        modifier: NonNullable<
          (typeof item.modifierGroups)[number]
        >["modifierGroup"]["modifiers"][number];
      }>
    >();
    const seen = new Set<string>();
    for (const selection of input.modifiers) {
      if (seen.has(selection.lineModifierId))
        fail(
          "MODIFIER_SELECTION_INVALID",
          "Line modifier IDs must be unique.",
          BadRequestException,
        );
      seen.add(selection.lineModifierId);
      const attachment = item.modifierGroups.find(({ modifierGroup }) =>
        modifierGroup.modifiers.some(({ id }) => id === selection.modifierId),
      );
      const modifier = attachment?.modifierGroup.modifiers.find(
        ({ id }) => id === selection.modifierId,
      );
      if (
        !attachment ||
        !attachment.modifierGroup.isActive ||
        !modifier?.isActive ||
        !modifier.isAvailable
      )
        fail(
          "CATALOG_ENTRY_UNAVAILABLE",
          "A selected modifier or attached group is inactive or unavailable.",
          BadRequestException,
        );
      const values = selectedByGroup.get(attachment.modifierGroupId) ?? [];
      values.push({ selection, modifier });
      selectedByGroup.set(attachment.modifierGroupId, values);
    }

    const modifierRows: Prisma.OrderLineModifierCreateWithoutOrderLineInput[] =
      [];
    for (const attachment of item.modifierGroups) {
      const group = attachment.modifierGroup;
      if (!group.isActive)
        fail(
          "CATALOG_ENTRY_UNAVAILABLE",
          "An attached modifier group is inactive.",
          BadRequestException,
        );
      const selected = selectedByGroup.get(group.id) ?? [];
      const count = selected.reduce(
        (sum, { selection }) => sum + selection.quantity,
        0,
      );
      if (count < group.minimum || count > group.maximum)
        fail(
          "MODIFIER_SELECTION_INVALID",
          `Modifier group ${group.name} requires ${group.minimum}-${group.maximum} selections.`,
          BadRequestException,
        );
      const assigned = assignFreeSelections(
        selected.map(({ selection, modifier }) => ({
          id: selection.lineModifierId,
          deltaMinor: modifier.priceDeltaMinor,
          quantity: selection.quantity,
        })),
        group.freeSelectionCount,
      );
      if (assigned.issue)
        fail(
          assigned.issue,
          "Mixed-price free modifier selection requires owner policy confirmation.",
        );
      const assignedSelections = assigned.selections ?? [];
      for (const calculated of assignedSelections) {
        const selectedModifier = selected.find(
          ({ selection }) => selection.lineModifierId === calculated.id,
        )!;
        modifierRows.push({
          id: calculated.id,
          menuModifierId: selectedModifier.modifier.id,
          modifierGroupId: group.id,
          stationId: selectedModifier.modifier.stationId,
          modifierNameSnapshot: selectedModifier.modifier.name,
          modifierGroupNameSnapshot: group.name,
          stationNameSnapshot: selectedModifier.modifier.station?.name ?? null,
          quantity: calculated.quantity,
          configuredDeltaMinor: calculated.deltaMinor,
          chargedDeltaMinor: calculated.chargedDeltaMinor,
          isFree:
            calculated.chargedDeltaMinor === 0 && calculated.deltaMinor > 0,
        });
      }
    }
    await this.inventoryAvailability?.assertOrderSelection(tx, {
      branchId: order.branchId,
      menuItemId: item.id,
      menuVariantId: variant?.id ?? null,
      menuModifierIds: modifierRows.map(({ menuModifierId }) => menuModifierId),
      quantity: input.quantity,
      at: now,
    });
    const modifierUnitTotalMinor = modifierRows.reduce(
      (sum, modifier) => sum + modifier.chargedDeltaMinor,
      0,
    );
    const unitInputAmountMinor = price.amountMinor + modifierUnitTotalMinor;
    const lineInputAmountMinor = unitInputAmountMinor * input.quantity;
    if (
      !Number.isSafeInteger(lineInputAmountMinor) ||
      lineInputAmountMinor > 2_000_000_000
    )
      fail(
        "ORDER_AMOUNT_LIMIT_EXCEEDED",
        "The line total exceeds the supported integer range.",
        BadRequestException,
      );
    return {
      id: lineId,
      order: { connect: { id: order.id } },
      createdBy: { connect: { id: actorId } },
      ...(replacesLineId && { replaces: { connect: { id: replacesLineId } } }),
      menuItemId: item.id,
      variantId: variant?.id ?? null,
      stationId: item.defaultStationId,
      taxClassId: item.taxClass.id,
      quantity: input.quantity,
      note: input.note ?? null,
      itemNameSnapshot: item.name,
      itemSkuSnapshot: variant?.sku ?? item.sku,
      categoryKeySnapshot: item.category.externalKey ?? item.category.id,
      categoryNameSnapshot: item.category.name,
      variantNameSnapshot: variant?.name ?? null,
      stationNameSnapshot: item.defaultStation?.name ?? null,
      taxClassKeySnapshot: item.taxClass.key,
      taxClassLabelSnapshot: item.taxClass.label,
      taxTreatmentSnapshot: item.taxClass.treatment,
      baseUnitPriceMinor: price.amountMinor,
      modifierUnitTotalMinor,
      unitInputAmountMinor,
      lineInputAmountMinor,
      netAmountMinor: lineInputAmountMinor,
      taxTotalMinor: 0,
      grossAmountMinor: lineInputAmountMinor,
      modifiers: { create: modifierRows },
    };
  }

  private async taxProfile(
    tx: Tx,
    order: {
      id: string;
      branchId: string;
      currency: string;
      taxProfileId: string | null;
    },
  ) {
    const now = new Date();
    const profile = order.taxProfileId
      ? await tx.taxProfile.findUnique({
          where: { id: order.taxProfileId },
          include: { components: true },
        })
      : await tx.taxProfile.findFirst({
          where: {
            branchId: order.branchId,
            currency: order.currency,
            status: TaxProfileStatus.ACTIVE,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          include: { components: true },
          orderBy: { effectiveFrom: "desc" },
        });
    if (!profile)
      fail(
        "TAX_CONFIGURATION_MISSING",
        "An approved active tax profile is required before adding the first line.",
      );
    return profile;
  }

  private async recalculate(
    tx: Tx,
    order: { id: string; taxProfileId: string | null },
    profile: Awaited<ReturnType<OrdersService["taxProfile"]>> | null,
    expectedRevision: number,
  ) {
    const lines = await tx.orderLine.findMany({
      where: { orderId: order.id, status: OrderLineStatus.DRAFT },
    });
    const calculated = profile
      ? calculateOrder(
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
        )
      : {
          lines: new Map(),
          totals: {
            inputSubtotalMinor: 0,
            netTotalMinor: 0,
            taxTotalMinor: 0,
            grossTotalMinor: 0,
          },
        };
    for (const line of lines) {
      const value = calculated.lines.get(line.id);
      if (!value) continue;
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
      where: { id: order.id, revision: expectedRevision },
      data: {
        revision: { increment: 1 },
        ...calculated.totals,
        ...(!order.taxProfileId &&
          profile && {
            taxProfileId: profile.id,
            taxProfileKeySnapshot: profile.key,
            taxProfileNameSnapshot: profile.name,
            taxProfileRevision: profile.revision,
            taxPriceMode: profile.priceMode,
            taxRoundingMode: profile.roundingMode,
            taxRoundingScope: profile.roundingScope,
          }),
      },
    });
    if (updated.count !== 1)
      fail("STALE_REVISION", "The order changed since it was read.");
    return expectedRevision + 1;
  }

  private async mutableOrder(
    tx: Tx,
    orderId: string,
    branchId: string,
    revision: number,
    principal: AuthPrincipal,
  ) {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
    });
    if (!order) throw new NotFoundException("Order not found.");
    if (order.revision !== revision)
      fail("STALE_REVISION", "The order changed since it was read.");
    if (order.status !== OrderStatus.OPEN)
      fail(
        "ORDER_STATE_INVALID",
        "Lines can only be changed while the order is open.",
      );
    if (order.deviceId !== principal.deviceId)
      fail(
        "ORDER_SHIFT_NOT_OPEN",
        "The order belongs to another device shift.",
      );
    return order;
  }

  private hasProtectedContact(order: {
    customerContact?: {
      piiCiphertext: Uint8Array<ArrayBufferLike> | null;
    } | null;
  }) {
    return Boolean(order.customerContact?.piiCiphertext);
  }

  private visibleOrder<
    T extends {
      id: string;
      customerPhone: string | null;
      deliveryDirections: string | null;
      customerContact?: {
        customerId: string | null;
        piiCiphertext: Uint8Array<ArrayBufferLike> | null;
        piiIv: Uint8Array<ArrayBufferLike> | null;
        piiAuthTag: Uint8Array<ArrayBufferLike> | null;
        piiKeyVersion: string | null;
      } | null;
    },
  >(order: T, allowed: boolean, organizationId: string) {
    const { customerContact, ...safeOrder } = order;
    if (!allowed)
      return {
        ...safeOrder,
        customerPhone: null,
        deliveryDirections: null,
      };
    if (
      !customerContact?.piiCiphertext ||
      !customerContact.piiIv ||
      !customerContact.piiAuthTag ||
      !customerContact.piiKeyVersion
    )
      return safeOrder;
    if (!this.customerPii)
      fail(
        "CUSTOMER_PII_CONFIGURATION_MISSING",
        "Customer contact encryption is not available.",
      );
    const pii = this.customerPii.unprotect(
      {
        ciphertext: Buffer.from(customerContact.piiCiphertext),
        iv: Buffer.from(customerContact.piiIv),
        authTag: Buffer.from(customerContact.piiAuthTag),
        keyVersion: customerContact.piiKeyVersion,
      },
      {
        organizationId,
        resourceType: "order-contact",
        resourceId: order.id,
      },
    );
    return {
      ...safeOrder,
      customerPhone: pii.phone ?? null,
      deliveryDirections: pii.deliveryDirections ?? null,
    };
  }

  private async find(
    client: Tx | PrismaService,
    orderId: string,
    branchId: string,
    organizationId: string,
  ) {
    const order = await client.order.findFirst({
      where: { id: orderId, branchId, branch: { organizationId } },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException("Order not found.");
    return order;
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

  private permission(principal: AuthPrincipal, key: string, branchId: string) {
    if (!hasPermission(principal, key, branchId))
      throw new ForbiddenException(
        "The user lacks permission for the requested branch.",
      );
  }

  private event(
    tx: Tx,
    orderId: string,
    principal: AuthPrincipal,
    type: OrderEventType,
    revision: number,
    reason: string,
    data?: Prisma.InputJsonObject,
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

  private result(
    branchId: string,
    orderId: string,
    eventType: string,
    response: unknown,
    reason: string,
    metadata?: Prisma.InputJsonObject,
  ): MutationResult {
    return {
      branchId,
      orderId,
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
    work: (tx: Tx) => Promise<MutationResult>,
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
              entityId: result.orderId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                ...(result.metadata ?? {}),
              },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "order",
              aggregateId: result.orderId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: result.branchId,
                orderId: result.orderId,
              },
            },
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
          error.code === "P2002" ? "TABLE_OCCUPIED" : "ORDER_CONFLICT",
          "The order conflicts with another active order or concurrent change.",
        );
      throw error;
    }
  }
}
