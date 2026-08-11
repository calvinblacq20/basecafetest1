import {
  cancelPaymentRequestSchema,
  completeOrderRequestSchema,
  createPaymentRequestSchema,
  idempotencyKeySchema,
  identifierSchema,
  paymentListQuerySchema,
  verifyManualPaymentRequestSchema,
  type CancelPaymentRequest,
  type CompleteOrderRequest,
  type CreatePaymentRequest,
  type PaymentListQuery,
  type VerifyManualPaymentRequest,
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
import { PaymentsService } from "./payments.service.js";

const idempotency = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller()
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  @Get("payments/branches/:branchId")
  @RequirePermissions("payments.read")
  @ApiOperation({ summary: "List branch payments with bounded filters" })
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(paymentListQuerySchema))
    query: PaymentListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.list(branchId, query, request.user);
  }

  @Get("payments/branches/:branchId/:paymentId")
  @RequirePermissions("payments.read")
  @ApiOperation({ summary: "Get a payment allocation and event timeline" })
  get(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("paymentId", new ZodValidationPipe(identifierSchema))
    paymentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.get(branchId, paymentId, request.user);
  }

  @Post("orders/:orderId/payments")
  @RequirePermissions("payments.create")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Record cash or an unverified external tender" })
  create(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createPaymentRequestSchema))
    input: CreatePaymentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.create(orderId, input, idempotency(key), request.user);
  }

  @Post("payments/:paymentId/verify-manual")
  @RequirePermissions("payments.verify")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Independently verify a manual non-cash tender" })
  verify(
    @Param("paymentId", new ZodValidationPipe(identifierSchema))
    paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(verifyManualPaymentRequestSchema))
    input: VerifyManualPaymentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.verify(
      paymentId,
      input,
      idempotency(key),
      request.user,
    );
  }

  @Post("payments/:paymentId/cancel")
  @RequirePermissions("payments.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Cancel a payment awaiting verification" })
  cancel(
    @Param("paymentId", new ZodValidationPipe(identifierSchema))
    paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(cancelPaymentRequestSchema))
    input: CancelPaymentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.cancel(
      paymentId,
      input,
      idempotency(key),
      request.user,
    );
  }

  @Post("orders/:orderId/complete")
  @RequirePermissions("orders.complete")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Complete a fully paid and prepared order" })
  complete(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(completeOrderRequestSchema))
    input: CompleteOrderRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.completeOrder(
      orderId,
      input,
      idempotency(key),
      request.user,
    );
  }
}
