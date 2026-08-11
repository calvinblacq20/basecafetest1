import type {
  SyncBatchRequest,
  SyncBatchResponse,
  SyncCommand,
  SyncCommandResult,
  SyncResultStatus,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { DeviceStatus, Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { InventoryConsumptionService } from "../inventory-consumption/inventory-consumption.service.js";
import { OrderSendingService } from "../orders/order-sending.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { PaymentsService } from "../payments/payments.service.js";

type TerminalStatus = "APPLIED" | "CONFLICT" | "REJECTED";

const json = (value: unknown) => value as Prisma.InputJsonValue;

function safeCode(error: unknown) {
  if (!(error instanceof HttpException)) return "SYNC_SERVICE_UNAVAILABLE";
  const response = error.getResponse();
  if (typeof response === "object" && response !== null && "code" in response) {
    const code = (response as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,120}$/.test(code))
      return code;
  }
  const status = error.getStatus();
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 409) return "SYNC_CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "SYNC_SERVICE_UNAVAILABLE" : "COMMAND_REJECTED";
}

function classification(error: unknown): {
  status: SyncResultStatus;
  retryable: boolean;
  persist?: TerminalStatus;
} {
  if (!(error instanceof HttpException))
    return { status: "RETRYABLE", retryable: true };
  const status = error.getStatus();
  if (status === 409)
    return { status: "CONFLICT", retryable: false, persist: "CONFLICT" };
  if (status === 408 || status === 425 || status === 429 || status >= 500)
    return { status: "RETRYABLE", retryable: true };
  return { status: "REJECTED", retryable: false, persist: "REJECTED" };
}

@Injectable()
export class SyncService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(OrderSendingService)
    private readonly sending: OrderSendingService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(InventoryConsumptionService)
    private readonly consumption: InventoryConsumptionService,
  ) {}

  async batch(
    input: SyncBatchRequest,
    principal: AuthPrincipal,
  ): Promise<SyncBatchResponse> {
    if (principal.mustChangePassword)
      throw new ForbiddenException({
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    const generatedAt = new Date();
    const blockedAggregates = new Set<string>();
    const results: SyncCommandResult[] = [];
    for (const command of input.commands) {
      if (blockedAggregates.has(command.aggregateId)) {
        results.push(
          this.result(
            command,
            "DEPENDENCY_BLOCKED",
            true,
            "EARLIER_AGGREGATE_COMMAND_FAILED",
            generatedAt,
          ),
        );
        continue;
      }
      const result = await this.process(command, principal, generatedAt);
      results.push(result);
      if (!["APPLIED", "REPLAYED"].includes(result.status))
        blockedAggregates.add(command.aggregateId);
    }
    return { generatedAt: generatedAt.toISOString(), results };
  }

  private async process(
    command: SyncCommand,
    principal: AuthPrincipal,
    receivedAt: Date,
  ): Promise<SyncCommandResult> {
    const hash = requestHash(command);
    let trustedOrigin = false;
    try {
      this.assertOrigin(command, principal);
      await this.assertDevice(command, principal);
      trustedOrigin = true;
      const prior = await this.prior(command, principal.organizationId);
      if (prior) {
        if (prior.commandId !== command.commandId || prior.payloadHash !== hash)
          throw new ConflictException({ code: "SYNC_COMMAND_ID_CONFLICT" });
        return this.result(
          command,
          prior.status === "APPLIED"
            ? "REPLAYED"
            : (prior.status as "CONFLICT" | "REJECTED"),
          false,
          prior.errorCode ?? "COMMAND_REPLAYED",
          receivedAt,
          prior.resultBody,
        );
      }
      const response = await this.dispatch(command, principal);
      await this.persist(
        command,
        principal.organizationId,
        hash,
        "APPLIED",
        "COMMAND_APPLIED",
        { code: "COMMAND_APPLIED", aggregateId: command.aggregateId },
      );
      return this.result(
        command,
        "APPLIED",
        false,
        "COMMAND_APPLIED",
        receivedAt,
        response,
      );
    } catch (error) {
      const state = classification(error);
      const code = safeCode(error);
      if (state.persist && trustedOrigin)
        await this.persist(
          command,
          principal.organizationId,
          hash,
          state.persist,
          code,
          { code, aggregateId: command.aggregateId },
        );
      return this.result(
        command,
        state.status,
        state.retryable,
        code,
        receivedAt,
      );
    }
  }

  private dispatch(command: SyncCommand, principal: AuthPrincipal) {
    switch (command.commandType) {
      case "ORDER_CREATE":
        return this.orders.create(
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_LINE_ADD":
        return this.orders.addLine(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_LINE_REPLACE":
        return this.orders.replaceLine(
          command.aggregateId,
          command.targetLineId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_LINE_REMOVE":
        return this.orders.removeLine(
          command.aggregateId,
          command.targetLineId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_HOLD":
        return this.orders.hold(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_RESUME":
        return this.orders.resume(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_CANCEL":
        return this.orders.cancel(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_SEND":
        return this.sending.send(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "CASH_PAYMENT_CREATE":
        if (command.payload.method !== "CASH")
          throw new ForbiddenException({
            code: "OFFLINE_PAYMENT_POLICY_NOT_CONFIGURED",
          });
        return this.payments.create(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "ORDER_COMPLETE":
        return this.payments.completeOrder(
          command.aggregateId,
          command.payload,
          command.idempotencyKey,
          principal,
        );
      case "INVENTORY_CONSUMPTION_POST":
        return this.consumption.post(
          command.payload,
          command.idempotencyKey,
          principal,
        );
    }
  }

  private assertOrigin(command: SyncCommand, principal: AuthPrincipal) {
    if (
      command.actorId !== principal.userId ||
      command.deviceId !== principal.deviceId
    )
      throw new ForbiddenException({ code: "SYNC_ORIGIN_MISMATCH" });
  }

  private async assertDevice(command: SyncCommand, principal: AuthPrincipal) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: command.deviceId,
        branchId: command.branchId,
        organizationId: principal.organizationId,
        status: DeviceStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!device)
      throw new ForbiddenException({ code: "SYNC_DEVICE_NOT_ACTIVE" });
  }

  private prior(command: SyncCommand, organizationId: string) {
    return this.prisma.syncCommandReceipt.findFirst({
      where: {
        organizationId,
        branchId: command.branchId,
        OR: [
          { commandId: command.commandId },
          {
            deviceId: command.deviceId,
            localSequence: BigInt(command.localSequence),
          },
        ],
      },
    });
  }

  private async persist(
    command: SyncCommand,
    organizationId: string,
    payloadHash: string,
    status: TerminalStatus,
    errorCode: string,
    resultBody: unknown,
  ) {
    try {
      await this.prisma.syncCommandReceipt.create({
        data: {
          commandId: command.commandId,
          organizationId,
          branchId: command.branchId,
          deviceId: command.deviceId,
          actorId: command.actorId,
          aggregateId: command.aggregateId,
          commandType: command.commandType,
          localSequence: BigInt(command.localSequence),
          schemaVersion: command.schemaVersion,
          idempotencyKey: command.idempotencyKey,
          payloadHash,
          status,
          errorCode,
          resultBody: json(resultBody),
          deviceCreatedAt: new Date(command.createdAt),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const prior = await this.prior(command, organizationId);
        if (
          prior?.commandId === command.commandId &&
          prior.payloadHash === payloadHash
        )
          return;
        throw new ConflictException({ code: "SYNC_COMMAND_ID_CONFLICT" });
      }
      throw error;
    }
  }

  private result(
    command: SyncCommand,
    status: SyncResultStatus,
    retryable: boolean,
    code: string,
    receivedAt: Date,
    response?: unknown,
  ): SyncCommandResult {
    return {
      commandId: command.commandId,
      localSequence: command.localSequence,
      status,
      retryable,
      code,
      serverReceivedAt: receivedAt.toISOString(),
      clockSkewMs: receivedAt.getTime() - new Date(command.createdAt).getTime(),
      ...(response === undefined ? {} : { response }),
      warnings:
        Math.abs(receivedAt.getTime() - new Date(command.createdAt).getTime()) >
        5 * 60_000
          ? ["DEVICE_CLOCK_SKEW_DETECTED"]
          : [],
    };
  }
}
