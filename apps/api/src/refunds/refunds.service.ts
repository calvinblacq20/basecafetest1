import type {
  ApproveRefund,
  RefundListQuery,
  RequestRefund,
  ResolveRefund,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RefundStatus,
  StaffShiftStatus,
} from "@prisma/client";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { renderRefundHtml, type RefundSnapshot } from "./refund-renderer.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

const refundDetails = {
  requestedBy: { select: { displayName: true } },
  resolvedBy: { select: { displayName: true } },
  approval: {
    select: {
      id: true,
      approverId: true,
      decision: true,
      evidenceNote: true,
      reason: true,
      createdAt: true,
      approver: { select: { displayName: true } },
    },
  },
  document: { select: { id: true, createdAt: true } },
  payment: { select: { method: true, amountMinor: true } },
  order: { select: { orderNumber: true, grossTotalMinor: true } },
} satisfies Prisma.RefundInclude;

type RefundDetails = Prisma.RefundGetPayload<{
  include: typeof refundDetails;
}>;

function refundResponse(refund: RefundDetails) {
  return {
    id: refund.id,
    branchId: refund.branchId,
    paymentId: refund.paymentId,
    orderId: refund.orderId,
    shiftId: refund.shiftId,
    requestedById: refund.requestedById,
    requestedByDisplayName: refund.requestedBy.displayName,
    resolvedById: refund.resolvedById,
    resolvedByDisplayName: refund.resolvedBy?.displayName ?? null,
    kind: refund.kind,
    status: refund.status,
    fiscalStatus: refund.fiscalStatus,
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    evidenceNote: refund.evidenceNote,
    providerReference: refund.providerReference,
    reason: refund.reason,
    revision: refund.revision,
    confirmedAt: refund.confirmedAt,
    failedAt: refund.failedAt,
    rejectedAt: refund.rejectedAt,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
    payment: {
      method: refund.payment.method,
      amountMinor: refund.payment.amountMinor,
    },
    order: {
      orderNumber: refund.order.orderNumber,
      grossTotalMinor: refund.order.grossTotalMinor,
    },
    approval: refund.approval
      ? {
          id: refund.approval.id,
          approverId: refund.approval.approverId,
          approverDisplayName: refund.approval.approver.displayName,
          decision: refund.approval.decision,
          evidenceNote: refund.approval.evidenceNote,
          reason: refund.approval.reason,
          createdAt: refund.approval.createdAt,
        }
      : null,
    document: refund.document
      ? {
          id: refund.document.id,
          label: "NOT A FISCAL CREDIT NOTE" as const,
          createdAt: refund.document.createdAt,
        }
      : null,
  };
}

@Injectable()
export class RefundsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    branchId: string,
    query: RefundListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "refunds.read", branchId);
    const refunds = await this.prisma.refund.findMany({
      where: {
        branchId,
        branch: { organizationId: principal.organizationId },
        ...(query.paymentId ? { paymentId: query.paymentId } : {}),
        ...(query.orderId ? { orderId: query.orderId } : {}),
        ...(query.shiftId ? { shiftId: query.shiftId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: refundDetails,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return refunds.map(refundResponse);
  }

  request(
    paymentId: string,
    input: RequestRefund,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "refunds.request", input.branchId);
    return this.idempotent(
      "refunds.request",
      key,
      { paymentId, ...input },
      principal,
      async (tx) => {
        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: {
            order: { select: { id: true, status: true, orderNumber: true } },
            refunds: {
              where: {
                status: {
                  in: ["AWAITING_APPROVAL", "PENDING_PROVIDER", "CONFIRMED"],
                },
              },
              select: { amountMinor: true },
            },
          },
        });
        if (!payment) throw new NotFoundException("Payment not found.");
        if (payment.status !== PaymentStatus.CONFIRMED)
          throw new ConflictException({ code: "PAYMENT_NOT_REFUNDABLE" });
        if (payment.revision !== input.paymentRevision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (payment.order.status !== "COMPLETED")
          throw new ConflictException({ code: "ORDER_NOT_SETTLED" });
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
        if (!shift || shift.currency !== payment.currency)
          throw new ConflictException({ code: "REFUND_SHIFT_NOT_OPEN" });
        const reserved = payment.refunds.reduce(
          (sum, refund) => sum + refund.amountMinor,
          0,
        );
        if (input.amountMinor > payment.amountMinor - reserved)
          throw new ConflictException({ code: "REFUND_EXCEEDS_REFUNDABLE" });
        const refund = await tx.refund.create({
          data: {
            id: input.refundId,
            branchId: input.branchId,
            paymentId,
            orderId: payment.orderId,
            shiftId: input.shiftId,
            requestedById: principal.userId,
            kind: input.kind,
            status: RefundStatus.AWAITING_APPROVAL,
            currency: payment.currency,
            amountMinor: input.amountMinor,
            evidenceNote: input.evidenceNote,
            reason: input.reason,
          },
        });
        return this.result(
          refund.id,
          "refund.requested",
          input.reason,
          refundResponse(await this.details(tx, refund.id)),
        );
      },
    );
  }

  approve(
    refundId: string,
    input: ApproveRefund,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "refunds.approve", input.branchId);
    return this.idempotent(
      "refunds.approve",
      key,
      { refundId, ...input },
      principal,
      async (tx) => {
        const refund = await this.mutable(
          tx,
          refundId,
          input.branchId,
          principal,
        );
        if (refund.revision !== input.revision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (refund.status !== RefundStatus.AWAITING_APPROVAL)
          throw new ConflictException({ code: "REFUND_APPROVAL_INVALID" });
        if (refund.requestedById === principal.userId)
          throw new ForbiddenException({
            code: "REFUND_SELF_APPROVAL_FORBIDDEN",
          });
        const rejected = input.decision === "REJECT";
        const cash = refund.payment.method === PaymentMethod.CASH;
        const status = rejected
          ? RefundStatus.REJECTED
          : cash
            ? RefundStatus.CONFIRMED
            : RefundStatus.PENDING_PROVIDER;
        const now = new Date();
        await tx.refund.update({
          where: { id: refund.id },
          data: {
            status,
            revision: { increment: 1 },
            resolvedById: rejected || cash ? principal.userId : null,
            rejectedAt: rejected ? now : null,
            confirmedAt: cash && !rejected ? now : null,
            evidenceNote: input.evidenceNote,
          },
        });
        await tx.refundApproval.create({
          data: {
            id: input.approvalId,
            refundId: refund.id,
            approverId: principal.userId,
            deviceId: principal.deviceId,
            decision: input.decision,
            evidenceNote: input.evidenceNote,
            reason: input.reason,
          },
        });
        if (status === RefundStatus.CONFIRMED)
          await this.createDocument(
            tx,
            { ...refund, confirmedAt: now },
            input.reason,
          );
        return this.result(
          refund.id,
          rejected
            ? "refund.rejected"
            : cash
              ? "refund.confirmed"
              : "refund.provider_pending",
          input.reason,
          refundResponse(await this.details(tx, refund.id)),
        );
      },
    );
  }

  resolve(
    refundId: string,
    input: ResolveRefund,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "refunds.resolve", input.branchId);
    return this.idempotent(
      "refunds.resolve",
      key,
      { refundId, ...input },
      principal,
      async (tx) => {
        const refund = await this.mutable(
          tx,
          refundId,
          input.branchId,
          principal,
        );
        if (refund.revision !== input.revision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (
          refund.status !== RefundStatus.PENDING_PROVIDER ||
          refund.payment.method === PaymentMethod.CASH
        )
          throw new ConflictException({ code: "REFUND_RESOLUTION_INVALID" });
        if (
          refund.requestedById === principal.userId ||
          refund.approval?.approverId === principal.userId
        )
          throw new ForbiddenException({
            code: "REFUND_RESOLUTION_SEPARATION_REQUIRED",
          });
        const confirmed = input.outcome === "CONFIRMED";
        const now = new Date();
        const status = confirmed ? RefundStatus.CONFIRMED : RefundStatus.FAILED;
        await tx.refund.update({
          where: { id: refund.id },
          data: {
            status,
            revision: { increment: 1 },
            resolvedById: principal.userId,
            providerReference: input.providerReference,
            evidenceNote: input.evidenceNote,
            confirmedAt: confirmed ? now : null,
            failedAt: confirmed ? null : now,
          },
        });
        if (confirmed)
          await this.createDocument(
            tx,
            { ...refund, confirmedAt: now },
            input.reason,
          );
        return this.result(
          refund.id,
          confirmed ? "refund.confirmed" : "refund.failed",
          input.reason,
          refundResponse(await this.details(tx, refund.id)),
        );
      },
    );
  }

  private mutable(
    tx: Tx,
    id: string,
    branchId: string,
    principal: AuthPrincipal,
  ) {
    return tx.refund.findFirstOrThrow({
      where: {
        id,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: {
        payment: { select: { method: true, amountMinor: true } },
        order: {
          select: {
            orderNumber: true,
            receipt: { select: { receiptNumber: true } },
          },
        },
        approval: true,
      },
    });
  }
  private details(tx: Tx, id: string) {
    return tx.refund.findUniqueOrThrow({
      where: { id },
      include: refundDetails,
    });
  }
  private async createDocument(
    tx: Tx,
    refund: {
      id: string;
      kind: string;
      amountMinor: number;
      currency: string;
      confirmedAt: Date;
      payment: { method: string };
      order: {
        orderNumber: string;
        receipt: { receiptNumber: string } | null;
      };
    },
    reason: string,
  ) {
    const snapshot: RefundSnapshot = {
      label: "NOT A FISCAL CREDIT NOTE",
      refundId: refund.id,
      receiptNumber: refund.order.receipt?.receiptNumber ?? null,
      orderNumber: refund.order.orderNumber,
      paymentMethod: refund.payment.method,
      kind: refund.kind,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      confirmedAt: refund.confirmedAt.toISOString(),
      reason,
    };
    await tx.refundReceipt.create({
      data: {
        refundId: refund.id,
        snapshot: json(snapshot),
        snapshotHash: requestHash(snapshot),
        renderedHtml: renderRefundHtml(snapshot),
      },
    });
  }
  private permission(p: AuthPrincipal, key: string, branchId: string) {
    if (!hasPermission(p, key, branchId))
      throw new ForbiddenException("Permission denied for branch.");
  }
  private result(
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
  ) {
    return { entityId, eventType, reason, response: json(response) };
  }
  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<{
      entityId: string;
      eventType: string;
      reason: string;
      response: Prisma.InputJsonObject;
    }>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const result = await work(tx);
        const branchId = (command as { branchId: string }).branchId;
        await tx.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            branchId,
            actorId: principal.userId,
            action: scope,
            entityType: "refund",
            entityId: result.entityId,
            reason: result.reason,
            metadata: { deviceId: principal.deviceId },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "refund",
            aggregateId: result.entityId,
            eventType: result.eventType,
            payload: {
              organizationId: principal.organizationId,
              branchId,
              refundId: result.entityId,
            },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            actorId: principal.userId,
            scope,
            key,
            requestHash: hash,
            responseBody: result.response,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        return result.response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
