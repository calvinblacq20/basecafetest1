import type {
  ApproveCashMovement,
  CashMovementListQuery,
  RequestCashMovement,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CashMovementStatus, Prisma, StaffShiftStatus } from "@prisma/client";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

type Tx = Prisma.TransactionClient;

const toJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

const cashMovementDetails = {
  requestedBy: { select: { displayName: true } },
  approval: {
    include: { approver: { select: { displayName: true } } },
  },
  correctsMovement: {
    select: {
      id: true,
      type: true,
      direction: true,
      amountMinor: true,
      reference: true,
    },
  },
} satisfies Prisma.CashMovementInclude;

type CashMovementDetails = Prisma.CashMovementGetPayload<{
  include: typeof cashMovementDetails;
}>;

function cashMovementResponse(movement: CashMovementDetails) {
  return {
    id: movement.id,
    branchId: movement.branchId,
    shiftId: movement.shiftId,
    requestedById: movement.requestedById,
    requestedByDisplayName: movement.requestedBy.displayName,
    type: movement.type,
    direction: movement.direction,
    status: movement.status,
    revision: movement.revision,
    currency: movement.currency,
    amountMinor: movement.amountMinor,
    reference: movement.reference,
    evidenceNote: movement.evidenceNote,
    reason: movement.reason,
    correctsMovement: movement.correctsMovement,
    approval: movement.approval
      ? {
          id: movement.approval.id,
          approverId: movement.approval.approverId,
          approverDisplayName: movement.approval.approver.displayName,
          decision: movement.approval.decision,
          evidenceNote: movement.approval.evidenceNote,
          reason: movement.approval.reason,
          createdAt: movement.approval.createdAt,
        }
      : null,
    postedAt: movement.postedAt,
    rejectedAt: movement.rejectedAt,
    createdAt: movement.createdAt,
    updatedAt: movement.updatedAt,
  };
}

@Injectable()
export class CashMovementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    branchId: string,
    query: CashMovementListQuery,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "cash-movements.read", branchId);
    const movements = await this.prisma.cashMovement.findMany({
      where: {
        branchId,
        branch: { organizationId: principal.organizationId },
        ...(query.shiftId ? { shiftId: query.shiftId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: cashMovementDetails,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return movements.map(cashMovementResponse);
  }

  request(
    input: RequestCashMovement,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "cash-movements.request", input.branchId);
    return this.idempotent(
      "cash-movements.request",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        const shift = await transaction.staffShift.findFirst({
          where: {
            id: input.shiftId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
            status: StaffShiftStatus.OPEN,
            deviceId: principal.deviceId,
            currentCashierId: principal.userId,
          },
          select: { id: true, revision: true, currency: true },
        });
        if (!shift) {
          throw new ConflictException({ code: "CASH_MOVEMENT_SHIFT_NOT_OPEN" });
        }
        if (shift.revision !== input.shiftRevision) {
          throw new ConflictException({ code: "STALE_REVISION" });
        }
        if (input.correctsMovementId) {
          const corrected = await transaction.cashMovement.findFirst({
            where: {
              id: input.correctsMovementId,
              branchId: input.branchId,
              branch: { organizationId: principal.organizationId },
              status: CashMovementStatus.POSTED,
              currency: shift.currency,
            },
            select: { id: true },
          });
          if (!corrected) {
            throw new ConflictException({
              code: "CASH_CORRECTION_SOURCE_INVALID",
            });
          }
        }
        const movement = await transaction.cashMovement.create({
          data: {
            id: input.movementId,
            branchId: input.branchId,
            shiftId: input.shiftId,
            requestedById: principal.userId,
            type: input.type,
            direction: input.direction,
            currency: shift.currency,
            amountMinor: input.amountMinor,
            correctsMovementId: input.correctsMovementId ?? null,
            reference: input.reference ?? null,
            evidenceNote: input.evidenceNote,
            reason: input.reason,
          },
        });
        return this.result(
          movement.id,
          "cash_movement.requested",
          input.reason,
          cashMovementResponse(await this.details(transaction, movement.id)),
        );
      },
    );
  }

  approve(
    movementId: string,
    input: ApproveCashMovement,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "cash-movements.approve", input.branchId);
    return this.idempotent(
      "cash-movements.approve",
      idempotencyKey,
      { movementId, ...input },
      principal,
      async (transaction) => {
        const movement = await transaction.cashMovement.findFirst({
          where: {
            id: movementId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: { shift: { select: { status: true } }, approval: true },
        });
        if (!movement) throw new NotFoundException("Cash movement not found.");
        if (movement.revision !== input.revision) {
          throw new ConflictException({ code: "STALE_REVISION" });
        }
        if (
          movement.status !== CashMovementStatus.AWAITING_APPROVAL ||
          movement.approval
        ) {
          throw new ConflictException({
            code: "CASH_MOVEMENT_APPROVAL_INVALID",
          });
        }
        if (movement.shift.status !== StaffShiftStatus.OPEN) {
          throw new ConflictException({ code: "CASH_MOVEMENT_SHIFT_NOT_OPEN" });
        }
        if (movement.requestedById === principal.userId) {
          throw new ForbiddenException({
            code: "CASH_MOVEMENT_SELF_APPROVAL_FORBIDDEN",
          });
        }
        const approved = input.decision === "APPROVE";
        const status = approved
          ? CashMovementStatus.POSTED
          : CashMovementStatus.REJECTED;
        const now = new Date();
        await transaction.cashMovement.update({
          where: { id: movement.id },
          data: {
            status,
            revision: { increment: 1 },
            postedAt: approved ? now : null,
            rejectedAt: approved ? null : now,
          },
        });
        await transaction.cashMovementApproval.create({
          data: {
            id: input.approvalId,
            movementId: movement.id,
            approverId: principal.userId,
            deviceId: principal.deviceId,
            decision: input.decision,
            evidenceNote: input.evidenceNote,
            reason: input.reason,
          },
        });
        return this.result(
          movement.id,
          approved ? "cash_movement.posted" : "cash_movement.rejected",
          input.reason,
          cashMovementResponse(await this.details(transaction, movement.id)),
        );
      },
    );
  }

  private assertPermission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId)) {
      throw new ForbiddenException("Permission denied for branch.");
    }
  }

  private details(transaction: Tx, id: string) {
    return transaction.cashMovement.findUniqueOrThrow({
      where: { id },
      include: cashMovementDetails,
    });
  }

  private result(
    entityId: string,
    eventType: string,
    reason: string,
    response: unknown,
  ) {
    return { entityId, eventType, reason, response: toJson(response) };
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (transaction: Tx) => Promise<{
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
      if (existing.requestHash !== hash) {
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      }
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const result = await work(transaction);
          const branchId = (command as { branchId: string }).branchId;
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "cash_movement",
              entityId: result.entityId,
              reason: result.reason,
              metadata: { deviceId: principal.deviceId },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "cash_movement",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId,
                cashMovementId: result.entityId,
              },
            },
          });
          await transaction.idempotencyRecord.create({
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2004", "P2034"].includes(error.code)
      ) {
        throw new ConflictException({ code: "CASH_MOVEMENT_CONFLICT" });
      }
      throw error;
    }
  }
}
