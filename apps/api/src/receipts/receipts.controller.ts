import {
  createReceiptRequestSchema,
  idempotencyKeySchema,
  identifierSchema,
  reprintReceiptRequestSchema,
  receiptListQuerySchema,
  retryPrintJobRequestSchema,
  updatePrintJobRequestSchema,
  type CreateReceiptRequest,
  type ReprintReceiptRequest,
  type ReceiptListQuery,
  type RetryPrintJobRequest,
  type UpdatePrintJobRequest,
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
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ReceiptsService } from "./receipts.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("receipts")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller()
export class ReceiptsController {
  constructor(
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
  ) {}
  @Get("receipts/branches/:branchId")
  @RequirePermissions("receipts.read")
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(receiptListQuerySchema))
    query: ReceiptListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.list(branchId, query, request.user);
  }
  @Post("orders/:orderId/receipts")
  @RequirePermissions("receipts.create")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  create(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createReceiptRequestSchema))
    input: CreateReceiptRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.create(orderId, input, key(value), request.user);
  }
  @Get("receipts/:receiptId")
  @RequirePermissions("receipts.read")
  get(
    @Param("receiptId", new ZodValidationPipe(identifierSchema))
    receiptId: string,
    @Query("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.get(receiptId, branchId, request.user);
  }
  @Get("receipts/:receiptId/render")
  @RequirePermissions("receipts.read")
  @ApiOperation({ summary: "Render immutable print-ready 80mm HTML" })
  async render(
    @Param("receiptId", new ZodValidationPipe(identifierSchema))
    receiptId: string,
    @Query("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query("reprint") reprint: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    response
      .type("html")
      .send(
        await this.receipts.html(
          receiptId,
          branchId,
          request.user,
          reprint === "true",
        ),
      );
  }
  @Post("receipts/:receiptId/reprint")
  @RequirePermissions("receipts.reprint")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  reprint(
    @Param("receiptId", new ZodValidationPipe(identifierSchema))
    receiptId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(reprintReceiptRequestSchema))
    input: ReprintReceiptRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.reprint(receiptId, input, key(value), request.user);
  }
  @Post("print-jobs/:printJobId/status")
  @RequirePermissions("print-jobs.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  status(
    @Param("printJobId", new ZodValidationPipe(identifierSchema))
    printJobId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(updatePrintJobRequestSchema))
    input: UpdatePrintJobRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.updatePrintJob(
      printJobId,
      input,
      key(value),
      request.user,
    );
  }
  @Post("print-jobs/:printJobId/retry")
  @RequirePermissions("print-jobs.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  retry(
    @Param("printJobId", new ZodValidationPipe(identifierSchema))
    printJobId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(retryPrintJobRequestSchema))
    input: RetryPrintJobRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receipts.updatePrintJob(
      printJobId,
      input,
      key(value),
      request.user,
    );
  }
}
