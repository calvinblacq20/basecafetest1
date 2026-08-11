import {
  cancelSentOrderLineRequestSchema,
  idempotencyKeySchema,
  identifierSchema,
  sendOrderWaveRequestSchema,
  type CancelSentOrderLineRequest,
  type SendOrderWaveRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
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
import { OrderSendingService } from "./order-sending.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("orders")
export class OrderSendingController {
  constructor(
    @Inject(OrderSendingService)
    private readonly sending: OrderSendingService,
  ) {}

  @Post(":orderId/send-waves")
  @RequirePermissions("orders.send")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Send unsent draft lines to preparation stations" })
  send(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(sendOrderWaveRequestSchema))
    input: SendOrderWaveRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sending.send(orderId, input, key(value), request.user);
  }

  @Post(":orderId/lines/:lineId/cancel-sent")
  @RequirePermissions("orders.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Append an approved sent-line cancellation" })
  cancelSentLine(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Param("lineId", new ZodValidationPipe(identifierSchema)) lineId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(cancelSentOrderLineRequestSchema))
    input: CancelSentOrderLineRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sending.cancelSentLine(
      orderId,
      lineId,
      input,
      key(value),
      request.user,
    );
  }
}
