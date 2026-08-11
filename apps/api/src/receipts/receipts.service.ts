import type {
  CreateReceiptRequest,
  ReceiptListQuery,
  ReprintReceiptRequest,
  RetryPrintJobRequest,
  UpdatePrintJobRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderLineStatus, OrderStatus, Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { renderReceiptHtml, type ReceiptSnapshot } from "./receipt-renderer.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

type PrintJobProjection = {
  id: string;
  receiptId: string;
  status: string;
  revision: number;
  copies: number;
  attemptCount: number;
  targetPrinter: string | null;
  errorCode: string | null;
  printedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const printJobResponse = (job: PrintJobProjection) => ({
  ...job,
  status: job.status as
    "QUEUED" | "PRINTING" | "PRINTED" | "FAILED" | "CANCELLED",
  printedAt: job.printedAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
});

function snapshotTotal(snapshot: Prisma.JsonValue) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const value = snapshot.totalMinor;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

type ReceiptHistoryProjection = {
  id: string;
  branchId: string;
  orderId: string;
  receiptNumber: string;
  businessDate: Date;
  currency: string;
  snapshot: Prisma.JsonValue;
  createdAt: Date;
  order: { orderNumber: string };
  fiscalDocument: { status: string } | null;
};

const receiptHistoryResponse = (
  receipt: ReceiptHistoryProjection,
  reprintCount: number,
  latestPrintJob: PrintJobProjection | null,
) => ({
  id: receipt.id,
  branchId: receipt.branchId,
  orderId: receipt.orderId,
  orderNumber: receipt.order.orderNumber,
  receiptNumber: receipt.receiptNumber,
  businessDate: receipt.businessDate.toISOString().slice(0, 10),
  currency: receipt.currency,
  totalMinor: snapshotTotal(receipt.snapshot),
  fiscalStatus: (receipt.fiscalDocument?.status ?? "NOT_REQUIRED") as
    | "NOT_REQUIRED"
    | "PENDING"
    | "ISSUED"
    | "FAILED"
    | "OFFLINE_PENDING"
    | "CANCELLED"
    | "CREDIT_NOTE"
    | "RECONCILED",
  reprintCount,
  latestPrintJob: latestPrintJob ? printJobResponse(latestPrintJob) : null,
  createdAt: receipt.createdAt.toISOString(),
});

@Injectable()
export class ReceiptsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    branchId: string,
    query: ReceiptListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "receipts.read", branchId);
    const receipts = await this.prisma.receipt.findMany({
      where: {
        branchId,
        branch: { organizationId: principal.organizationId },
        ...(query.search
          ? {
              OR: [
                {
                  receiptNumber: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  order: {
                    orderNumber: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        branchId: true,
        orderId: true,
        receiptNumber: true,
        businessDate: true,
        currency: true,
        snapshot: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
        fiscalDocument: { select: { status: true } },
        _count: { select: { reprints: true } },
        printJobs: {
          select: {
            id: true,
            receiptId: true,
            status: true,
            revision: true,
            copies: true,
            attemptCount: true,
            targetPrinter: true,
            errorCode: true,
            printedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
    });
    return {
      generatedAt: new Date().toISOString(),
      items: receipts.map((receipt) =>
        receiptHistoryResponse(
          receipt,
          receipt._count.reprints,
          receipt.printJobs[0] ?? null,
        ),
      ),
    };
  }

  async get(receiptId: string, branchId: string, principal: AuthPrincipal) {
    this.permission(principal, "receipts.read", branchId);
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        id: receiptId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      select: {
        id: true,
        branchId: true,
        orderId: true,
        receiptNumber: true,
        businessDate: true,
        currency: true,
        snapshot: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
        fiscalDocument: { select: { status: true } },
        reprints: {
          select: { id: true, copies: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        printJobs: {
          select: {
            id: true,
            receiptId: true,
            status: true,
            revision: true,
            copies: true,
            attemptCount: true,
            targetPrinter: true,
            errorCode: true,
            printedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!receipt) throw new NotFoundException("Receipt not found.");
    return {
      ...receiptHistoryResponse(
        receipt,
        receipt.reprints.length,
        receipt.printJobs.at(-1) ?? null,
      ),
      reprints: receipt.reprints.map((reprint) => ({
        ...reprint,
        createdAt: reprint.createdAt.toISOString(),
      })),
      printJobs: receipt.printJobs.map(printJobResponse),
    };
  }

  async html(
    receiptId: string,
    branchId: string,
    principal: AuthPrincipal,
    reprint = false,
  ) {
    this.permission(principal, "receipts.read", branchId);
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        id: receiptId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
      select: { snapshot: true, renderedHtml: true },
    });
    if (!receipt) throw new NotFoundException("Receipt not found.");
    return reprint
      ? renderReceiptHtml(receipt.snapshot as unknown as ReceiptSnapshot, true)
      : receipt.renderedHtml;
  }

  create(
    orderId: string,
    input: CreateReceiptRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "receipts.create", input.branchId);
    return this.idempotent(
      "receipts.create",
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
          include: {
            branch: { select: { name: true } },
            completedBy: { select: { displayName: true } },
            mergesAsTarget: { select: { sourceOrderId: true } },
          },
        });
        if (!order) throw new NotFoundException("Order not found.");
        if (order.status !== OrderStatus.COMPLETED)
          throw new ConflictException({
            code: "ORDER_NOT_COMPLETED",
            message: "Only completed orders can produce a receipt.",
          });
        if (order.revision !== input.orderRevision)
          throw new ConflictException({
            code: "STALE_REVISION",
            message: "The order changed since it was read.",
          });
        const orderIds = [
          order.id,
          ...order.mergesAsTarget.map(({ sourceOrderId }) => sourceOrderId),
        ];
        const lines = await tx.orderLine.findMany({
          where: {
            orderId: { in: orderIds },
            status: OrderLineStatus.DRAFT,
            sentCancelledAt: null,
          },
          include: { modifiers: true, taxComponents: true },
          orderBy: { id: "asc" },
        });
        const payments = await tx.payment.findMany({
          where: {
            status: "CONFIRMED",
            allocations: { some: { orderId: { in: orderIds } } },
          },
          select: {
            id: true,
            method: true,
            amountMinor: true,
            changeMinor: true,
          },
          orderBy: { id: "asc" },
        });
        const tax = new Map<string, number>();
        for (const line of lines)
          for (const component of line.taxComponents)
            tax.set(
              component.receiptLabelSnapshot,
              (tax.get(component.receiptLabelSnapshot) ?? 0) +
                component.amountMinor,
            );
        const sequence = await tx.branchReceiptSequence.upsert({
          where: {
            branchId_businessDate: {
              branchId: order.branchId,
              businessDate: order.businessDate,
            },
          },
          create: {
            branchId: order.branchId,
            businessDate: order.businessDate,
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
          select: { lastValue: true },
        });
        const receiptNumber = `R-${order.businessDate.toISOString().slice(0, 10).replaceAll("-", "")}-${String(sequence.lastValue).padStart(4, "0")}`;
        const snapshot: ReceiptSnapshot = {
          label: "NOT A FISCAL RECEIPT",
          receiptNumber,
          orderNumber: order.orderNumber,
          branchName: order.branch.name,
          businessDate: order.businessDate.toISOString().slice(0, 10),
          completedAt: order.completedAt!.toISOString(),
          cashierName: order.completedBy?.displayName ?? "Recorded staff",
          channel: order.channel,
          currency: order.currency,
          lines: lines.map((line) => ({
            name: [line.itemNameSnapshot, line.variantNameSnapshot]
              .filter(Boolean)
              .join(" - "),
            quantity: line.quantity,
            grossMinor: line.grossAmountMinor,
            modifiers: line.modifiers.map(
              (modifier) =>
                `${modifier.quantity} x ${modifier.modifierNameSnapshot}`,
            ),
          })),
          taxComponents: [...tax]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, amountMinor]) => ({ label, amountMinor })),
          tenders: payments.map((payment) => ({
            method: payment.method.replaceAll("_", " "),
            amountMinor: payment.amountMinor,
            changeMinor: payment.changeMinor,
          })),
          netMinor: lines.reduce((sum, line) => sum + line.netAmountMinor, 0),
          taxMinor: lines.reduce((sum, line) => sum + line.taxTotalMinor, 0),
          totalMinor: lines.reduce(
            (sum, line) => sum + line.grossAmountMinor,
            0,
          ),
          footer:
            "Commercial receipt only. Fiscal status: NOT REQUIRED / NOT CONFIGURED.",
        };
        const snapshotHash = requestHash(snapshot);
        const receipt = await tx.receipt.create({
          data: {
            id: input.receiptId,
            branchId: order.branchId,
            orderId: order.id,
            createdById: principal.userId,
            businessDate: order.businessDate,
            sequence: sequence.lastValue,
            receiptNumber,
            currency: order.currency,
            snapshot: json(snapshot),
            snapshotHash,
            renderedHtml: renderReceiptHtml(snapshot),
            fiscalDocument: {
              create: {
                id: input.fiscalDocumentId,
                branchId: order.branchId,
                createdById: principal.userId,
                status: "NOT_REQUIRED",
              },
            },
          },
          include: { fiscalDocument: true },
        });
        return {
          entityId: receipt.id,
          eventType: "receipt.created",
          reason: input.reason,
          response: json(receipt),
        };
      },
    );
  }

  reprint(
    receiptId: string,
    input: ReprintReceiptRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "receipts.reprint", input.branchId);
    return this.idempotent(
      "receipts.reprint",
      key,
      { receiptId, ...input },
      principal,
      async (tx) => {
        const receipt = await tx.receipt.findFirst({
          where: {
            id: receiptId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (!receipt) throw new NotFoundException("Receipt not found.");
        await tx.receiptReprint.create({
          data: {
            id: input.reprintId,
            receiptId,
            actorId: principal.userId,
            deviceId: principal.deviceId,
            copies: input.copies,
            reason: input.reason,
          },
        });
        const printJob = await tx.printJob.create({
          data: {
            id: input.printJobId,
            branchId: input.branchId,
            receiptId,
            createdById: principal.userId,
            deviceId: principal.deviceId,
            copies: input.copies,
            targetPrinter: input.targetPrinter,
            reason: input.reason,
          },
        });
        return {
          entityId: receiptId,
          eventType: "receipt.reprint_queued",
          reason: input.reason,
          response: json({ receiptId, reprintId: input.reprintId, printJob }),
        };
      },
    );
  }

  updatePrintJob(
    printJobId: string,
    input: UpdatePrintJobRequest | RetryPrintJobRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "print-jobs.manage", input.branchId);
    return this.idempotent(
      "print-jobs.update",
      key,
      { printJobId, ...input },
      principal,
      async (tx) => {
        const job = await tx.printJob.findFirst({
          where: {
            id: printJobId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
        });
        if (!job) throw new NotFoundException("Print job not found.");
        if (job.revision !== input.revision)
          throw new ConflictException({ code: "STALE_REVISION" });
        if (!("status" in input) && job.status !== "FAILED")
          throw new ConflictException({
            code: "PRINT_JOB_NOT_RETRYABLE",
            message: "Only failed print jobs can be retried.",
          });
        const status = "status" in input ? input.status : "QUEUED";
        const updated = await tx.printJob.update({
          where: { id: job.id },
          data: {
            status,
            revision: { increment: 1 },
            attemptCount: status === "PRINTING" ? { increment: 1 } : undefined,
            errorCode: "errorCode" in input ? input.errorCode : null,
            printedAt: status === "PRINTED" ? new Date() : null,
          },
        });
        return {
          entityId: job.receiptId,
          eventType: `print_job.${status.toLowerCase()}`,
          reason: input.reason,
          response: json(updated),
        };
      },
    );
  }

  private permission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId))
      throw new ForbiddenException("Permission denied for branch.");
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
        await tx.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            branchId: (command as { branchId: string }).branchId,
            actorId: principal.userId,
            action: scope,
            entityType: "receipt",
            entityId: result.entityId,
            reason: result.reason,
            metadata: { deviceId: principal.deviceId },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "receipt",
            aggregateId: result.entityId,
            eventType: result.eventType,
            payload: {
              organizationId: principal.organizationId,
              branchId: (command as { branchId: string }).branchId,
              receiptId: result.entityId,
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
