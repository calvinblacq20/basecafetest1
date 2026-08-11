import {
  auditIntegrityBatchListQuerySchema,
  auditReviewQuerySchema,
  createAuditIntegrityBatchRequestSchema,
  idempotencyKeySchema,
  verifyAuditIntegrityRequestSchema,
  type AuditIntegrityBatchListQuery,
  type AuditReviewQuery,
  type CreateAuditIntegrityBatchRequest,
  type VerifyAuditIntegrityRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
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
  ApiProduces,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AuditIntegrityService } from "./audit-integrity.service.js";
import { AuditService } from "./audit.service.js";

@ApiTags("audit")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("audit")
export class AuditController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuditIntegrityService)
    private readonly integrity: AuditIntegrityService,
  ) {}

  @Get("integrity/batches")
  @RequirePermissions("audit.integrity.read")
  @ApiOperation({ summary: "List tamper-evident audit integrity batches" })
  integrityBatches(
    @Query(new ZodValidationPipe(auditIntegrityBatchListQuerySchema))
    query: AuditIntegrityBatchListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.integrity.list(query, request.user);
  }

  @Post("integrity/batches")
  @RequirePermissions("audit.integrity.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Seal the next bounded audit integrity batch" })
  createIntegrityBatch(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createAuditIntegrityBatchRequestSchema))
    input: CreateAuditIntegrityBatchRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.integrity.create(input, idempotencyKey, request.user);
  }

  @Post("integrity/verify")
  @RequirePermissions("audit.integrity.read")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Verify a bounded audit integrity chain" })
  verifyIntegrity(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(verifyAuditIntegrityRequestSchema))
    input: VerifyAuditIntegrityRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.integrity.verify(input, idempotencyKey, request.user);
  }

  @Get()
  @RequirePermissions("audit.read")
  @ApiOperation({ summary: "View append-only audit history" })
  async list(
    @Query(new ZodValidationPipe(auditReviewQuerySchema))
    query: AuditReviewQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.list(query, request.user);
  }

  @Get("export.csv")
  @RequirePermissions("audit.read", "audit.export")
  @ApiProduces("text/csv")
  @ApiOperation({ summary: "Export bounded redacted audit history" })
  async export(
    @Query(new ZodValidationPipe(auditReviewQuerySchema))
    query: AuditReviewQuery,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.audit.export(query, request.user);
    response.type("text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    return result.content;
  }
}
