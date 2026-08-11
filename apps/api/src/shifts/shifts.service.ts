import type {
  CloseShiftRequest,
  HandoverShiftRequest,
  OpenShiftRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, StaffShiftStatus } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { BranchHoursService } from "../branch-hours/branch-hours.service.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  normalizeDrawerKey,
  shiftActionIssue,
  shiftCloseApprovalRequired,
} from "./shift-policy.js";

type ShiftMutationResult = Readonly<{
  branchId: string;
  shiftId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
  metadata?: Prisma.InputJsonObject;
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function dateOnly(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

const shiftInclude = {
  device: { select: { id: true, name: true } },
  openedBy: { select: { id: true, displayName: true } },
  currentCashier: { select: { id: true, displayName: true } },
  scheduleVersion: {
    select: {
      id: true,
      effectiveFrom: true,
      businessDayCutoffMinute: true,
    },
  },
  responsibilities: {
    include: {
      cashier: { select: { id: true, displayName: true } },
      assignedBy: { select: { id: true, displayName: true } },
      endedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { startedAt: "asc" as const },
  },
  close: {
    include: {
      submittedBy: { select: { id: true, displayName: true } },
      approvedBy: { select: { id: true, displayName: true } },
    },
  },
} as const;

@Injectable()
export class ShiftsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchHoursService)
    private readonly branchHours: BranchHoursService,
  ) {}

  async list(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "shifts.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.staffShift.findMany({
      where: { branchId },
      include: shiftInclude,
      orderBy: { openedAt: "desc" },
      take: 200,
    });
  }

  async get(shiftId: string, branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "shifts.read", branchId);
    return this.findShift(
      this.prisma,
      shiftId,
      branchId,
      principal.organizationId,
    );
  }

  async current(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "shifts.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.staffShift.findFirst({
      where: {
        branchId,
        deviceId: principal.deviceId,
        status: StaffShiftStatus.OPEN,
      },
      include: shiftInclude,
    });
  }

  async open(
    input: OpenShiftRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "shifts.open", input.branchId);
    return this.executeIdempotent(
      "shifts.open",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        const device = await transaction.device.findFirst({
          where: {
            id: principal.deviceId,
            branchId: input.branchId,
            organizationId: principal.organizationId,
            status: "ACTIVE",
          },
          include: { branch: true },
        });
        if (!device) {
          throw new NotFoundException(
            "An active session device was not found for this branch.",
          );
        }
        const resolved = await this.branchHours.resolveForTrustedBranch(
          input.branchId,
          device.branch.timezone,
          new Date(),
          transaction,
        );
        if (!resolved.configurationReady || !resolved.businessDate) {
          throw new ConflictException(
            "CONFIGURATION_MISSING: an active branch schedule and cutoff are required before opening a shift.",
          );
        }
        const drawerKey = normalizeDrawerKey(input.drawerKey);
        const conflict = await transaction.staffShift.findFirst({
          where: {
            branchId: input.branchId,
            status: StaffShiftStatus.OPEN,
            OR: [
              { deviceId: principal.deviceId },
              { currentCashierId: principal.userId },
              ...(drawerKey ? [{ drawerKey }] : []),
            ],
          },
          select: {
            id: true,
            deviceId: true,
            currentCashierId: true,
            drawerKey: true,
          },
        });
        if (conflict) {
          throw new ConflictException(
            `An open shift already owns this device, cashier, or drawer (${conflict.id}).`,
          );
        }
        const shift = await transaction.staffShift.create({
          data: {
            id: input.shiftId,
            branchId: input.branchId,
            deviceId: principal.deviceId,
            scheduleVersionId: resolved.scheduleVersionId,
            openedById: principal.userId,
            currentCashierId: principal.userId,
            drawerKey,
            businessDate: dateOnly(resolved.businessDate),
            currency: device.branch.currency,
            openingFloatMinor: input.openingFloatMinor,
            ...(input.denominations !== undefined && {
              openingDenominations: toJson(input.denominations),
            }),
            responsibilities: {
              create: {
                cashierId: principal.userId,
                assignedById: principal.userId,
                reason: input.reason,
              },
            },
          },
          include: shiftInclude,
        });
        return this.result(
          input.branchId,
          shift.id,
          "shift.opened",
          shift,
          input.reason,
          {
            businessDate: resolved.businessDate,
            scheduleVersionId: resolved.scheduleVersionId,
          },
        );
      },
    );
  }

  async handover(
    shiftId: string,
    input: HandoverShiftRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "shifts.manage", input.branchId);
    return this.executeIdempotent(
      "shifts.handover",
      idempotencyKey,
      { shiftId, ...input },
      principal,
      async (transaction) => {
        const shift = await this.findShift(
          transaction,
          shiftId,
          input.branchId,
          principal.organizationId,
        );
        this.assertOpenRevision(shift, input.revision);
        if (shift.currentCashierId === input.receivingCashierId) {
          throw new ConflictException(
            "The receiving cashier already owns this shift.",
          );
        }
        const receiver = await transaction.user.findFirst({
          where: {
            id: input.receivingCashierId,
            organizationId: principal.organizationId,
            status: "ACTIVE",
            mustChangePassword: false,
          },
          include: {
            roles: {
              where: { revokedAt: null },
              include: { role: { include: { permissions: true } } },
            },
          },
        });
        const receiverAuthorized = receiver?.roles.some(
          (assignment) =>
            (assignment.role.scope === "ORGANIZATION" ||
              assignment.branchId === input.branchId) &&
            assignment.role.permissions.some(
              ({ permissionKey }) => permissionKey === "shifts.open",
            ),
        );
        if (!receiver || !receiverAuthorized) {
          throw new ForbiddenException(
            "The receiving cashier is not active and authorized to open shifts at this branch.",
          );
        }
        const otherShift = await transaction.staffShift.findFirst({
          where: {
            id: { not: shiftId },
            branchId: input.branchId,
            currentCashierId: input.receivingCashierId,
            status: StaffShiftStatus.OPEN,
          },
          select: { id: true },
        });
        if (otherShift) {
          throw new ConflictException(
            "The receiving cashier already owns another open shift.",
          );
        }
        const ended = await transaction.shiftResponsibility.updateMany({
          where: { shiftId, endedAt: null },
          data: { endedById: principal.userId, endedAt: new Date() },
        });
        if (ended.count !== 1) {
          throw new ConflictException(
            "The current shift responsibility changed; refresh and retry.",
          );
        }
        await transaction.shiftResponsibility.create({
          data: {
            shiftId,
            cashierId: input.receivingCashierId,
            assignedById: principal.userId,
            reason: input.reason,
          },
        });
        const updated = await transaction.staffShift.updateMany({
          where: {
            id: shiftId,
            revision: input.revision,
            status: StaffShiftStatus.OPEN,
          },
          data: {
            currentCashierId: input.receivingCashierId,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await this.findShift(
          transaction,
          shiftId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          shiftId,
          "shift.handed_over",
          response,
          input.reason,
          {
            previousCashierId: shift.currentCashierId,
            receivingCashierId: input.receivingCashierId,
          },
        );
      },
    );
  }

  async close(
    shiftId: string,
    input: CloseShiftRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "shifts.close", input.branchId);
    return this.executeIdempotent(
      "shifts.close",
      idempotencyKey,
      { shiftId, ...input },
      principal,
      async (transaction) => {
        const shift = await this.findShift(
          transaction,
          shiftId,
          input.branchId,
          principal.organizationId,
        );
        this.assertOpenRevision(shift, input.revision);
        if (
          shift.currentCashierId !== principal.userId &&
          !hasPermission(principal, "shifts.manage", input.branchId)
        ) {
          throw new ForbiddenException(
            "Only the current cashier or a shift manager can close this shift.",
          );
        }
        const pendingPayments = await transaction.payment.findMany({
          where: {
            shiftId,
            status: { in: ["PENDING", "REQUIRES_VERIFICATION"] },
          },
          select: { id: true, orderId: true, method: true, status: true },
          take: 20,
        });
        if (pendingPayments.length > 0) {
          throw new ConflictException({
            code: "SHIFT_PENDING_PAYMENTS",
            message:
              "Resolve every pending or unverified payment before closing the shift.",
            paymentCount: pendingPayments.length,
            payments: pendingPayments,
          });
        }
        const pendingRefunds = await transaction.refund.findMany({
          where: {
            shiftId,
            status: { in: ["AWAITING_APPROVAL", "PENDING_PROVIDER"] },
          },
          select: { id: true, paymentId: true, kind: true, status: true },
          take: 20,
        });
        if (pendingRefunds.length > 0) {
          throw new ConflictException({
            code: "SHIFT_PENDING_REFUNDS",
            message:
              "Resolve every requested or provider-pending refund before closing the shift.",
            refundCount: pendingRefunds.length,
            refunds: pendingRefunds,
          });
        }
        const pendingCashMovements = await transaction.cashMovement.findMany({
          where: { shiftId, status: "AWAITING_APPROVAL" },
          select: { id: true, type: true, direction: true, amountMinor: true },
          take: 20,
        });
        if (pendingCashMovements.length > 0) {
          throw new ConflictException({
            code: "SHIFT_PENDING_CASH_MOVEMENTS",
            message:
              "Approve or reject every requested cash movement before closing the shift.",
            cashMovementCount: pendingCashMovements.length,
            cashMovements: pendingCashMovements,
          });
        }
        const confirmedCash = await transaction.payment.aggregate({
          where: {
            shiftId,
            status: "CONFIRMED",
            method: "CASH",
          },
          _sum: { amountMinor: true },
        });
        const confirmedCashRefunds = await transaction.refund.aggregate({
          where: {
            shiftId,
            status: "CONFIRMED",
            payment: { method: "CASH" },
          },
          _sum: { amountMinor: true },
        });
        const postedCashMovements = await transaction.cashMovement.groupBy({
          by: ["direction"],
          where: { shiftId, status: "POSTED" },
          _sum: { amountMinor: true },
        });
        const postedCashInMinor =
          postedCashMovements.find((movement) => movement.direction === "IN")
            ?._sum.amountMinor ?? 0;
        const postedCashOutMinor =
          postedCashMovements.find((movement) => movement.direction === "OUT")
            ?._sum.amountMinor ?? 0;
        const expectedCashMinor =
          shift.openingFloatMinor +
          (confirmedCash._sum.amountMinor ?? 0) -
          (confirmedCashRefunds._sum.amountMinor ?? 0) +
          postedCashInMinor -
          postedCashOutMinor;
        const varianceMinor = input.countedCashMinor - expectedCashMinor;
        const approvalRequired = shiftCloseApprovalRequired(
          input.countedCashMinor,
          expectedCashMinor,
        );
        if (
          approvalRequired &&
          !hasPermission(principal, "shifts.manage", input.branchId)
        ) {
          throw new ForbiddenException(
            "A non-zero cash variance requires shifts.manage approval.",
          );
        }
        const openOrders = await transaction.order.findMany({
          where: { shiftId, status: { in: ["OPEN", "HELD"] } },
          select: { id: true, orderNumber: true },
          take: 20,
        });
        if (openOrders.length > 0) {
          throw new ConflictException({
            code: "SHIFT_OPEN_ORDERS",
            message: "The shift cannot close while it has open or held orders.",
            orderCount: openOrders.length,
            orders: openOrders,
          });
        }
        const closedAt = new Date();
        const ended = await transaction.shiftResponsibility.updateMany({
          where: { shiftId, endedAt: null },
          data: { endedById: principal.userId, endedAt: closedAt },
        });
        if (ended.count !== 1) {
          throw new ConflictException(
            "The current shift responsibility changed; refresh and retry.",
          );
        }
        const updated = await transaction.staffShift.updateMany({
          where: {
            id: shiftId,
            revision: input.revision,
            status: StaffShiftStatus.OPEN,
          },
          data: {
            status: StaffShiftStatus.CLOSED,
            closedAt,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        await transaction.shiftClose.create({
          data: {
            shiftId,
            submittedById: principal.userId,
            approvedById: approvalRequired ? principal.userId : null,
            countedCashMinor: input.countedCashMinor,
            expectedCashMinor,
            varianceMinor,
            ...(input.denominations !== undefined && {
              closingDenominations: toJson(input.denominations),
            }),
            declaration: input.declaration,
            reason: input.reason,
            closedAt,
          },
        });
        const response = await this.findShift(
          transaction,
          shiftId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          shiftId,
          "shift.closed",
          response,
          input.reason,
          { expectedCashMinor, varianceMinor, approvalRequired },
        );
      },
    );
  }

  private assertOpenRevision(
    shift: { status: StaffShiftStatus; revision: number },
    expectedRevision: number,
  ) {
    const issue = shiftActionIssue({
      status: shift.status,
      actualRevision: shift.revision,
      expectedRevision,
    });
    if (issue === "STALE_REVISION") this.throwRevisionConflict();
    if (issue === "NOT_OPEN") {
      throw new ConflictException("Only an open shift can be changed.");
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

  private async assertBranch(
    client: Prisma.TransactionClient | PrismaService,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    return branch;
  }

  private async findShift(
    client: Prisma.TransactionClient | PrismaService,
    shiftId: string,
    branchId: string,
    organizationId: string,
  ) {
    const shift = await client.staffShift.findFirst({
      where: { id: shiftId, branchId, branch: { organizationId } },
      include: shiftInclude,
    });
    if (!shift) throw new NotFoundException("Shift not found.");
    return shift;
  }

  private result(
    branchId: string,
    shiftId: string,
    eventType: string,
    response: unknown,
    reason: string,
    metadata?: Prisma.InputJsonObject,
  ): ShiftMutationResult {
    return {
      branchId,
      shiftId,
      eventType,
      response: toJson(response),
      reason,
      metadata,
    };
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The shift changed since it was read. Refresh and retry.",
    );
  }

  private async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (
      transaction: Prisma.TransactionClient,
    ) => Promise<ShiftMutationResult>,
  ) {
    const hashValue = requestHash(command);
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
      if (existing.requestHash !== hashValue) {
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
              entityType: "staff_shift",
              entityId: result.shiftId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                ...(result.metadata ?? {}),
              },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "staff_shift",
              aggregateId: result.shiftId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: result.branchId,
                shiftId: result.shiftId,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
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
      ) {
        throw new ConflictException(
          "The shift conflicts with another active device, cashier, drawer, or concurrent change.",
        );
      }
      throw error;
    }
  }
}
