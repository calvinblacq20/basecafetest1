import {
  approveRefundSchema,
  idempotencyKeySchema,
  identifierSchema,
  refundListQuerySchema,
  requestRefundSchema,
  resolveRefundSchema,
  type ApproveRefund,
  type RefundListQuery,
  type RequestRefund,
  type ResolveRefund,
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
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RefundsService } from "./refunds.service.js";
const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);
@ApiTags("refunds")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller()
export class RefundsController {
  constructor(
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}
  @Get("refunds/branches/:branchId")
  @RequirePermissions("refunds.read")
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(refundListQuerySchema)) query: RefundListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.list(branchId, query, request.user);
  }
  @Post("payments/:paymentId/refunds")
  @RequirePermissions("refunds.request")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  request(
    @Param("paymentId", new ZodValidationPipe(identifierSchema))
    paymentId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(requestRefundSchema)) input: RequestRefund,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.request(paymentId, input, key(value), request.user);
  }
  @Post("refunds/:refundId/approve")
  @RequirePermissions("refunds.approve")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  approve(
    @Param("refundId", new ZodValidationPipe(identifierSchema))
    refundId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(approveRefundSchema)) input: ApproveRefund,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.approve(refundId, input, key(value), request.user);
  }
  @Post("refunds/:refundId/resolve")
  @RequirePermissions("refunds.resolve")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  resolve(
    @Param("refundId", new ZodValidationPipe(identifierSchema))
    refundId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(resolveRefundSchema)) input: ResolveRefund,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.resolve(refundId, input, key(value), request.user);
  }
}
