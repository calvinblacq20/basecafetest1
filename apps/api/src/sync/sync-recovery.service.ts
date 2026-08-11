import type { ResolveSyncCommandRequest } from "@base-cafe/contracts";
import {
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

function responseItem(command: {
  commandId: string;
  aggregateId: string;
  commandType: string;
  status: string;
  errorCode: string | null;
  localSequence: bigint;
  deviceCreatedAt: Date;
  receivedAt: Date;
  resolution: null | {
    id: string;
    action: string;
    successorCommandId: string | null;
    reason: string;
    resolvedById: string;
    resolvedAt: Date;
  };
}) {
  return {
    commandId: command.commandId,
    aggregateId: command.aggregateId,
    commandType: command.commandType,
    status: command.status as "CONFLICT" | "REJECTED",
    errorCode: command.errorCode,
    localSequence: command.localSequence.toString(),
    deviceCreatedAt: command.deviceCreatedAt.toISOString(),
    receivedAt: command.receivedAt.toISOString(),
    resolution: command.resolution
      ? {
          ...command.resolution,
          action: command.resolution.action as
            "ACKNOWLEDGED_NO_ACTION" | "SUPERSEDED_BY_COMMAND",
          resolvedAt: command.resolution.resolvedAt.toISOString(),
        }
      : null,
  };
}

@Injectable()
export class SyncRecoveryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "sync.recovery.read", branchId);
    const commands = await this.prisma.syncCommandReceipt.findMany({
      where: {
        organizationId: principal.organizationId,
        branchId,
        status: { in: ["CONFLICT", "REJECTED"] },
        resolution: null,
      },
      include: { resolution: true },
      orderBy: [{ receivedAt: "asc" }, { commandId: "asc" }],
      take: 200,
    });
    return {
      generatedAt: new Date().toISOString(),
      items: commands.map(responseItem),
    };
  }

  async resolve(
    commandId: string,
    input: ResolveSyncCommandRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "sync.recovery.manage", input.branchId);
    const scope = "sync.command.resolve";
    const commandHash = requestHash({ commandId, ...input });
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== commandHash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return prior.responseBody;
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const command = await transaction.syncCommandReceipt.findFirst({
            where: {
              commandId,
              organizationId: principal.organizationId,
              branchId: input.branchId,
            },
            include: { resolution: true },
          });
          if (!command) throw new NotFoundException("Sync command not found.");
          if (
            !(["CONFLICT", "REJECTED"] as const).includes(
              command.status as never,
            )
          )
            throw new ConflictException({ code: "SYNC_COMMAND_NOT_TERMINAL" });
          if (command.resolution)
            throw new ConflictException({
              code: "SYNC_COMMAND_ALREADY_RESOLVED",
            });

          if (input.action === "SUPERSEDED_BY_COMMAND") {
            const successor = await transaction.syncCommandReceipt.findFirst({
              where: {
                commandId: input.successorCommandId ?? undefined,
                organizationId: principal.organizationId,
                branchId: input.branchId,
                deviceId: command.deviceId,
                aggregateId: command.aggregateId,
                status: "APPLIED",
              },
            });
            if (!successor || successor.localSequence <= command.localSequence)
              throw new ConflictException({
                code: "SYNC_SUCCESSOR_NOT_APPLIED",
              });
          }

          const resolution = await transaction.syncCommandResolution.create({
            data: {
              commandId,
              successorCommandId: input.successorCommandId ?? null,
              resolvedById: principal.userId,
              action: input.action,
              reason: input.reason,
            },
          });
          const response = {
            commandId,
            resolutionId: resolution.id,
            action: input.action,
            successorCommandId: resolution.successorCommandId,
            resolvedAt: resolution.resolvedAt.toISOString(),
          };
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: input.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: "sync_command_receipt",
              entityId: commandId,
              reason: input.reason,
              metadata: {
                deviceId: principal.deviceId,
                resolutionAction: input.action,
                successorCommandId: resolution.successorCommandId,
              },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "sync_command_receipt",
              aggregateId: commandId,
              eventType: "sync.command.resolved",
              payload: {
                organizationId: principal.organizationId,
                branchId: input.branchId,
                commandId,
                action: input.action,
                successorCommandId: resolution.successorCommandId,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
              requestHash: commandHash,
              responseBody: response,
              expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException({ code: "SYNC_COMMAND_ALREADY_RESOLVED" });
      throw error;
    }
  }

  private assertPermission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId))
      throw new ForbiddenException({ code: "PERMISSION_DENIED" });
  }
}
