import type {
  CancelPaymentRequest,
  CompleteOrderRequest,
  CreatePaymentRequest,
  PaymentListQuery,
  VerifyManualPaymentRequest,
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
  InventoryDeductionTrigger,
  OrderEventType,
  OrderLineStatus,
  OrderStatus,
  PaymentEventType,
  PaymentMethod,
  PaymentStatus,
  PreparationTicketStatus,
  Prisma,
  StaffShiftStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { InventoryConsumptionService } from "../inventory-consumption/inventory-consumption.service.js";
import {
  initialPaymentState,
  outstandingMinor,
  verifiedPaymentState,
} from "./payment-policy.js";

type Tx = Prisma.TransactionClient;
type MutationResult = Readonly<{
  branchId: string;
  entityType: "payment" | "order";
  entityId: string;
  eventType: string;
  reason: string;
  response: Prisma.InputJsonObject;
  payload: Prisma.InputJsonObject;
}>;

const paymentDetails = {
  createdBy: { select: { displayName: true } },
  allocations: {
    select: {
      id: true,
      orderId: true,
      amountMinor: true,
      order: { select: { orderNumber: true, grossTotalMinor: true } },
    },
    orderBy: { orderId: "asc" as const },
  },
  events: {
    select: {
      id: true,
      actorId: true,
      type: true,
      fromStatus: true,
      toStatus: true,
      revision: true,
      reason: true,
      data: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "asc" as const },
  },
  verification: {
    select: {
      id: true,
      verifierId: true,
      decision: true,
      evidenceNote: true,
      reason: true,
      createdAt: true,
      verifier: { select: { displayName: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentDetails = Prisma.PaymentGetPayload<{
  include: typeof paymentDetails;
}>;

function paymentResponse(payment: PaymentDetails) {
  return {
    id: payment.id,
    branchId: payment.branchId,
    orderId: payment.orderId,
    shiftId: payment.shiftId,
    createdById: payment.createdById,
    createdByDisplayName: payment.createdBy.displayName,
    method: payment.method,
    status: payment.status,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    tenderedAmountMinor: payment.tenderedAmountMinor,
    changeMinor: payment.changeMinor,
    externalReference: payment.externalReference,
    evidenceNote: payment.evidenceNote,
    revision: payment.revision,
    confirmedAt: payment.confirmedAt,
    failedAt: payment.failedAt,
    cancelledAt: payment.cancelledAt,
    createdAt: payment.createdAt,
    allocations: payment.allocations,
    verification: payment.verification
      ? {
          id: payment.verification.id,
          verifierId: payment.verification.verifierId,
          verifierDisplayName: payment.verification.verifier.displayName,
          decision: payment.verification.decision,
          evidenceNote: payment.verification.evidenceNote,
          reason: payment.verification.reason,
          createdAt: payment.verification.createdAt,
        }
      : null,
  };
}

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
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
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(InventoryConsumptionService)
    private readonly inventoryConsumption?: InventoryConsumptionService,
  ) {}

  async list(
    branchId: string,
    query: PaymentListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "payments.read", branchId);
    await this.branch(branchId, principal);
    const payments = await this.prisma.payment.findMany({
      where: {
        branchId,
        ...(query.orderId ? { orderId: query.orderId } : {}),
        ...(query.shiftId ? { shiftId: query.shiftId } : {}),
        ...(query.method ? { method: query.method } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.externalReference
          ? { externalReference: query.externalReference }
          : {}),
      },
      include: paymentDetails,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return payments.map(paymentResponse);
  }

  async get(branchId: string, paymentId: string, principal: AuthPrincipal) {
    this.permission(principal, "payments.read", branchId);
    await this.branch(branchId, principal);
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, branchId },
      include: paymentDetails,
    });
    if (!payment) throw new NotFoundException("Payment not found.");
    return paymentResponse(payment);
  }

  create(
    orderId: string,
    input: CreatePaymentRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "payments.create", input.branchId);
    return this.idempotent(
      "payments.create",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          select: {
            id: true,
            status: true,
            currency: true,
            grossTotalMinor: true,
            mergesAsTarget: { select: { sourceOrderId: true } },
          },
        });
        if (!order) throw new NotFoundException("Order not found.");
        if (
          order.status !== OrderStatus.OPEN &&
          order.status !== OrderStatus.HELD
        )
          fail(
            "ORDER_NOT_PAYABLE",
            "Only open or held orders accept payments.",
          );
        const shift = await tx.staffShift.findFirst({
          where: {
            id: input.shiftId,
            branchId: input.branchId,
            status: StaffShiftStatus.OPEN,
            deviceId: principal.deviceId,
            currentCashierId: principal.userId,
          },
          select: { id: true, currency: true },
        });
        if (!shift)
          fail(
            "PAYMENT_SHIFT_NOT_OPEN",
            "The payment requires the current user's open device shift.",
          );
        if (shift.currency !== order.currency)
          fail(
            "PAYMENT_CURRENCY_MISMATCH",
            "The shift and order currencies differ.",
            BadRequestException,
          );

        const allowed = new Set([
          order.id,
          ...order.mergesAsTarget.map(({ sourceOrderId }) => sourceOrderId),
        ]);
        if (
          input.allocations.some(
            (allocation) => !allowed.has(allocation.orderId),
          )
        )
          fail(
            "PAYMENT_ALLOCATION_ORDER_INVALID",
            "Allocations may target only this order and its retained merge sources.",
            BadRequestException,
          );
        const allocatedOrders = await tx.order.findMany({
          where: {
            id: { in: input.allocations.map(({ orderId }) => orderId) },
          },
          select: { id: true, grossTotalMinor: true },
        });
        const totals = new Map(
          allocatedOrders.map((allocated) => [
            allocated.id,
            allocated.grossTotalMinor,
          ]),
        );
        for (const allocation of input.allocations) {
          const gross = totals.get(allocation.orderId);
          if (gross === undefined || gross <= 0)
            fail(
              "ORDER_HAS_NO_PAYABLE_BALANCE",
              "Every allocated order must have a positive total.",
              BadRequestException,
            );
          const prior = await tx.paymentAllocation.aggregate({
            where: {
              orderId: allocation.orderId,
              payment: { status: PaymentStatus.CONFIRMED },
            },
            _sum: { amountMinor: true },
          });
          if (
            allocation.amountMinor >
            outstandingMinor(gross, prior._sum.amountMinor ?? 0)
          )
            fail(
              "PAYMENT_EXCEEDS_OUTSTANDING",
              "An allocation exceeds the order's outstanding balance.",
            );
        }

        const state = initialPaymentState(
          input.method as PaymentMethod,
          input.amountMinor,
          input.tenderedAmountMinor,
        );
        const payment = await tx.payment.create({
          data: {
            id: input.paymentId,
            branchId: input.branchId,
            orderId,
            shiftId: input.shiftId,
            deviceId: principal.deviceId,
            createdById: principal.userId,
            method: input.method,
            status: state.status,
            currency: order.currency,
            amountMinor: input.amountMinor,
            tenderedAmountMinor: input.tenderedAmountMinor,
            changeMinor: state.changeMinor,
            externalReference: input.externalReference,
            network: input.network,
            merchantAccountReference: input.merchantAccountReference,
            evidenceNote: input.evidenceNote,
            confirmedAt: state.confirmedAt,
            allocations: {
              create: input.allocations.map((allocation) => ({
                id: allocation.allocationId,
                orderId: allocation.orderId,
                amountMinor: allocation.amountMinor,
              })),
            },
            events: {
              create: {
                actorId: principal.userId,
                deviceId: principal.deviceId,
                type: PaymentEventType.CREATED,
                toStatus: state.status,
                revision: 1,
                reason: input.reason,
                data: { allocationCount: input.allocations.length },
              },
            },
          },
          include: paymentDetails,
        });
        return this.result(
          input.branchId,
          "payment",
          payment.id,
          "payment.created",
          input.reason,
          paymentResponse(payment),
          { paymentId: payment.id, orderId, status: payment.status },
        );
      },
    );
  }

  verify(
    paymentId: string,
    input: VerifyManualPaymentRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "payments.verify", input.branchId);
    return this.idempotent(
      "payments.verify",
      key,
      { paymentId, ...input },
      principal,
      async (tx) => {
        const payment = await this.mutablePayment(
          tx,
          paymentId,
          input.branchId,
          principal,
        );
        if (payment.revision !== input.revision) this.stale();
        if (payment.status !== PaymentStatus.REQUIRES_VERIFICATION)
          fail(
            "PAYMENT_NOT_AWAITING_VERIFICATION",
            "This payment cannot be manually verified.",
          );
        if (payment.createdById === principal.userId)
          throw new ForbiddenException({
            code: "PAYMENT_SELF_VERIFICATION_FORBIDDEN",
            message: "A different authorized user must verify this payment.",
          });
        if (input.decision === "CONFIRM")
          await this.assertAllocationsOutstanding(tx, payment.allocations);
        const state = verifiedPaymentState(input.decision);
        const updated = await tx.payment.updateMany({
          where: {
            id: payment.id,
            revision: input.revision,
            status: PaymentStatus.REQUIRES_VERIFICATION,
          },
          data: {
            status: state.status,
            confirmedAt: state.confirmedAt,
            failedAt: state.failedAt,
            evidenceNote: input.evidenceNote,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stale();
        await tx.paymentVerification.create({
          data: {
            id: input.verificationId,
            paymentId: payment.id,
            verifierId: principal.userId,
            deviceId: principal.deviceId,
            decision: input.decision,
            evidenceNote: input.evidenceNote,
            reason: input.reason,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type:
              input.decision === "CONFIRM"
                ? PaymentEventType.VERIFICATION_CONFIRMED
                : PaymentEventType.VERIFICATION_FAILED,
            fromStatus: PaymentStatus.REQUIRES_VERIFICATION,
            toStatus: state.status,
            revision: input.revision + 1,
            reason: input.reason,
            data: { verificationId: input.verificationId },
          },
        });
        const response = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: paymentDetails,
        });
        return this.result(
          input.branchId,
          "payment",
          payment.id,
          input.decision === "CONFIRM" ? "payment.confirmed" : "payment.failed",
          input.reason,
          paymentResponse(response),
          { paymentId, orderId: payment.orderId, status: state.status },
        );
      },
    );
  }

  cancel(
    paymentId: string,
    input: CancelPaymentRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "payments.manage", input.branchId);
    return this.idempotent(
      "payments.cancel",
      key,
      { paymentId, ...input },
      principal,
      async (tx) => {
        const payment = await this.mutablePayment(
          tx,
          paymentId,
          input.branchId,
          principal,
        );
        if (payment.revision !== input.revision) this.stale();
        if (payment.status !== PaymentStatus.REQUIRES_VERIFICATION)
          fail(
            "PAYMENT_CANCELLATION_INVALID",
            "Only an unverified manual payment can be cancelled.",
          );
        const cancelledAt = new Date();
        const updated = await tx.payment.updateMany({
          where: {
            id: payment.id,
            revision: input.revision,
            status: PaymentStatus.REQUIRES_VERIFICATION,
          },
          data: {
            status: PaymentStatus.CANCELLED,
            cancelledAt,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stale();
        await tx.paymentEvent.create({
          data: {
            paymentId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: PaymentEventType.CANCELLED,
            fromStatus: PaymentStatus.REQUIRES_VERIFICATION,
            toStatus: PaymentStatus.CANCELLED,
            revision: input.revision + 1,
            reason: input.reason,
          },
        });
        const response = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: paymentDetails,
        });
        return this.result(
          input.branchId,
          "payment",
          payment.id,
          "payment.cancelled",
          input.reason,
          paymentResponse(response),
          { paymentId, orderId: payment.orderId },
        );
      },
    );
  }

  completeOrder(
    orderId: string,
    input: CompleteOrderRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "orders.complete", input.branchId);
    return this.idempotent(
      "orders.complete",
      key,
      { orderId, ...input },
      principal,
      async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: orderId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          select: {
            id: true,
            status: true,
            revision: true,
            grossTotalMinor: true,
            mergesAsTarget: {
              select: {
                sourceOrderId: true,
                source: { select: { grossTotalMinor: true } },
              },
            },
          },
        });
        if (!order) throw new NotFoundException("Order not found.");
        if (order.revision !== input.revision) this.stale();
        if (
          order.status !== OrderStatus.OPEN &&
          order.status !== OrderStatus.HELD
        )
          fail("ORDER_COMPLETION_INVALID", "The order is not active.");
        const orderIds = [
          order.id,
          ...order.mergesAsTarget.map(({ sourceOrderId }) => sourceOrderId),
        ];
        const grossTotal =
          order.grossTotalMinor +
          order.mergesAsTarget.reduce(
            (sum, merge) => sum + merge.source.grossTotalMinor,
            0,
          );
        if (grossTotal <= 0)
          fail(
            "ORDER_HAS_NO_PAYABLE_BALANCE",
            "An empty order cannot be completed.",
            BadRequestException,
          );
        const confirmed = await tx.paymentAllocation.aggregate({
          where: {
            orderId: { in: orderIds },
            payment: { status: PaymentStatus.CONFIRMED },
          },
          _sum: { amountMinor: true },
        });
        if ((confirmed._sum.amountMinor ?? 0) !== grossTotal)
          fail(
            "ORDER_PAYMENT_INCOMPLETE",
            "Confirmed allocations must exactly cover the order composition.",
          );
        const pending = await tx.payment.count({
          where: {
            allocations: { some: { orderId: { in: orderIds } } },
            status: {
              in: [PaymentStatus.PENDING, PaymentStatus.REQUIRES_VERIFICATION],
            },
          },
        });
        if (pending)
          fail(
            "ORDER_PAYMENT_PENDING",
            "Resolve unverified payments before completing the order.",
          );
        const unsent = await tx.orderLine.count({
          where: {
            orderId: { in: orderIds },
            status: OrderLineStatus.DRAFT,
            sentAt: null,
          },
        });
        if (unsent)
          fail(
            "ORDER_HAS_UNSENT_LINES",
            "Send or remove every draft line before completion.",
          );
        const activeTickets = await tx.preparationTicket.count({
          where: {
            orderId: { in: orderIds },
            status: {
              notIn: [
                PreparationTicketStatus.COMPLETED,
                PreparationTicketStatus.CANCELLED,
              ],
            },
          },
        });
        if (activeTickets)
          fail(
            "ORDER_PREPARATION_INCOMPLETE",
            "All kitchen and bar tickets must be terminal before completion.",
          );
        const completedAt = new Date();
        const updated = await tx.order.updateMany({
          where: {
            id: order.id,
            revision: input.revision,
            status: order.status,
          },
          data: {
            status: OrderStatus.COMPLETED,
            completedAt,
            completedById: principal.userId,
            heldAt: null,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stale();
        const completedEvent = await tx.orderEvent.create({
          data: {
            orderId: order.id,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            type: OrderEventType.COMPLETED,
            revision: input.revision + 1,
            reason: input.reason,
            data: {
              fromStatus: order.status,
              toStatus: OrderStatus.COMPLETED,
              compositionOrderIds: orderIds,
              grossTotalMinor: grossTotal,
            },
          },
        });
        const completedLines = await tx.orderLine.findMany({
          where: {
            orderId: { in: orderIds },
            status: OrderLineStatus.DRAFT,
            sentCancelledAt: null,
          },
          select: { id: true },
        });
        const inventory = await this.inventoryConsumption?.postAutomatically(
          tx,
          {
            branchId: input.branchId,
            orderLineIds: completedLines.map(({ id }) => id),
            sourceEventId: completedEvent.id,
            trigger: InventoryDeductionTrigger.COMPLETED,
            occurredAt: completedAt,
            reason: input.reason,
          },
          principal,
        );
        const response = {
          orderId: order.id,
          status: OrderStatus.COMPLETED,
          revision: input.revision + 1,
          completedAt,
          confirmedTotalMinor: grossTotal,
          compositionOrderIds: orderIds,
          inventory,
        };
        return this.result(
          input.branchId,
          "order",
          order.id,
          "order.completed",
          input.reason,
          response,
          { orderId, compositionOrderIds: orderIds },
        );
      },
    );
  }

  private async mutablePayment(
    tx: Tx,
    paymentId: string,
    branchId: string,
    principal: AuthPrincipal,
  ) {
    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      select: {
        id: true,
        orderId: true,
        createdById: true,
        status: true,
        revision: true,
        allocations: {
          select: { orderId: true, amountMinor: true },
          orderBy: { orderId: "asc" },
        },
      },
    });
    if (!payment) throw new NotFoundException("Payment not found.");
    return payment;
  }

  private async assertAllocationsOutstanding(
    tx: Tx,
    allocations: readonly { orderId: string; amountMinor: number }[],
  ) {
    for (const allocation of allocations) {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: allocation.orderId },
        select: { grossTotalMinor: true },
      });
      const confirmed = await tx.paymentAllocation.aggregate({
        where: {
          orderId: allocation.orderId,
          payment: { status: PaymentStatus.CONFIRMED },
        },
        _sum: { amountMinor: true },
      });
      if (
        allocation.amountMinor >
        outstandingMinor(order.grossTotalMinor, confirmed._sum.amountMinor ?? 0)
      )
        fail(
          "PAYMENT_EXCEEDS_OUTSTANDING",
          "Another payment already consumed this outstanding balance.",
        );
    }
  }

  private async branch(branchId: string, principal: AuthPrincipal) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
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

  private stale(): never {
    fail("STALE_REVISION", "The aggregate changed since it was read.");
  }

  private result(
    branchId: string,
    entityType: "payment" | "order",
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
    payload: Prisma.InputJsonObject,
  ): MutationResult {
    return {
      branchId,
      entityType,
      entityId,
      eventType,
      reason,
      response: json(response),
      payload,
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
          "The idempotency key was already used with another request.",
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
                ...result.payload,
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
          error.code === "P2002"
            ? "PAYMENT_REFERENCE_CONFLICT"
            : "PAYMENT_CONFLICT",
          "The payment conflicts with retained data or a concurrent change.",
        );
      throw error;
    }
  }
}
