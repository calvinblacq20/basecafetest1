import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  idempotencyKeySchema,
  identifierSchema,
  orderListQuerySchema,
  orderRevisionRequestSchema,
  removeOrderLineRequestSchema,
  replaceOrderLineRequestSchema,
  type AddOrderLineRequest,
  type CreateOrderRequest,
  type OrderListQuery,
  type OrderRevisionRequest,
  type RemoveOrderLineRequest,
  type ReplaceOrderLineRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
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
import { OrdersService } from "./orders.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get("branches/:branchId")
  @RequirePermissions("orders.read")
  @ApiOperation({ summary: "List filtered branch orders" })
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.list(branchId, query, request.user);
  }

  @Get("branches/:branchId/:orderId")
  @RequirePermissions("orders.read")
  @ApiOperation({
    summary: "Get an order aggregate, active snapshots, totals and timeline",
  })
  get(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.get(orderId, branchId, request.user);
  }

  @Post()
  @RequirePermissions("orders.create")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an open, shift-bound order" })
  create(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createOrderRequestSchema))
    input: CreateOrderRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.create(input, key(value), request.user);
  }

  @Post(":orderId/hold")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  hold(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(orderRevisionRequestSchema))
    input: OrderRevisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.hold(orderId, input, key(value), request.user);
  }

  @Post(":orderId/resume")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  resume(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(orderRevisionRequestSchema))
    input: OrderRevisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.resume(orderId, input, key(value), request.user);
  }

  @Post(":orderId/cancel")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  cancel(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(orderRevisionRequestSchema))
    input: OrderRevisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.cancel(orderId, input, key(value), request.user);
  }

  @Post(":orderId/lines")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  addLine(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(addOrderLineRequestSchema))
    input: AddOrderLineRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.addLine(orderId, input, key(value), request.user);
  }

  @Post(":orderId/lines/:lineId/replace")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  replaceLine(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Param("lineId", new ZodValidationPipe(identifierSchema)) lineId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(replaceOrderLineRequestSchema))
    input: ReplaceOrderLineRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.replaceLine(
      orderId,
      lineId,
      input,
      key(value),
      request.user,
    );
  }

  @Post(":orderId/lines/:lineId/remove")
  @RequirePermissions("orders.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  removeLine(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Param("lineId", new ZodValidationPipe(identifierSchema)) lineId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(removeOrderLineRequestSchema))
    input: RemoveOrderLineRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.removeLine(
      orderId,
      lineId,
      input,
      key(value),
      request.user,
    );
  }
}
