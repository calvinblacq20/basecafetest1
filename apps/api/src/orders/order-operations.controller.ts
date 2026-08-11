import {
  idempotencyKeySchema,
  identifierSchema,
  mergeOrdersRequestSchema,
  moveOrderTableRequestSchema,
  splitOrderRequestSchema,
  transferOrderResponsibilityRequestSchema,
  type MergeOrdersRequest,
  type MoveOrderTableRequest,
  type SplitOrderRequest,
  type TransferOrderResponsibilityRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { OrderOperationsService } from "./order-operations.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("orders")
export class OrderOperationsController {
  constructor(
    @Inject(OrderOperationsService)
    private readonly operations: OrderOperationsService,
  ) {}

  @Get("branches/:branchId/operation-options")
  @RequirePermissions("orders.owner.transfer")
  @ApiOperation({ summary: "List branch staff eligible to receive an order" })
  operationOptions(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.options(branchId, request.user);
  }

  @Post(":orderId/move-table")
  @RequirePermissions("orders.table.move")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Move or detach an active order table with history",
  })
  moveTable(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(moveOrderTableRequestSchema))
    input: MoveOrderTableRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.moveTable(orderId, input, key(value), request.user);
  }

  @Post(":orderId/transfer-owner")
  @RequirePermissions("orders.owner.transfer")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Transfer current server responsibility" })
  transferOwner(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transferOrderResponsibilityRequestSchema))
    input: TransferOrderResponsibilityRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.transferResponsibility(
      orderId,
      input,
      key(value),
      request.user,
    );
  }

  @Post(":orderId/merge")
  @RequirePermissions("orders.split-merge")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Merge a compatible open order with retained lineage",
  })
  merge(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(mergeOrdersRequestSchema))
    input: MergeOrdersRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.merge(orderId, input, key(value), request.user);
  }

  @Post(":orderId/split")
  @RequirePermissions("orders.split-merge")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Split unsent line quantities into a linked child order",
  })
  split(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(splitOrderRequestSchema))
    input: SplitOrderRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.split(orderId, input, key(value), request.user);
  }
}
