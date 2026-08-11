import {
  capturePilotReadinessReviewRequestSchema,
  idempotencyKeySchema,
  operationalEvidenceListQuerySchema,
  pilotReadinessListQuerySchema,
  recordPilotEvidenceRequestSchema,
  recordOperationalEvidenceRequestSchema,
  type CapturePilotReadinessReviewRequest,
  type OperationalEvidenceListQuery,
  type PilotReadinessListQuery,
  type RecordPilotEvidenceRequest,
  type RecordOperationalEvidenceRequest,
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
import { OperationsService } from "./operations.service.js";
import { PilotReadinessService } from "./pilot-readiness.service.js";

@ApiTags("operations")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("operations")
export class OperationsController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(PilotReadinessService)
    private readonly readiness: PilotReadinessService,
  ) {}

  @Get("pilot-readiness")
  @RequirePermissions("release.read")
  @ApiOperation({ summary: "Evaluate live pilot and production launch gates" })
  pilotReadiness(@Req() request: AuthenticatedRequest) {
    return this.readiness.live(request.user);
  }

  @Get("pilot-readiness/evidence")
  @RequirePermissions("release.read")
  @ApiOperation({ summary: "List append-only pilot readiness evidence" })
  readinessEvidence(
    @Query(new ZodValidationPipe(pilotReadinessListQuerySchema))
    query: PilotReadinessListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readiness.listEvidence(query, request.user);
  }

  @Post("pilot-readiness/evidence")
  @RequirePermissions("release.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Record append-only external readiness evidence" })
  recordReadinessEvidence(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(recordPilotEvidenceRequestSchema))
    input: RecordPilotEvidenceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.readiness.recordEvidence(input, idempotencyKey, request.user);
  }

  @Get("pilot-readiness/reviews")
  @RequirePermissions("release.read")
  @ApiOperation({ summary: "List immutable pilot readiness review snapshots" })
  readinessReviews(
    @Query(new ZodValidationPipe(pilotReadinessListQuerySchema))
    query: PilotReadinessListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readiness.listReviews(query, request.user);
  }

  @Post("pilot-readiness/reviews")
  @RequirePermissions("release.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Capture an immutable live readiness review" })
  captureReadinessReview(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(capturePilotReadinessReviewRequestSchema))
    input: CapturePilotReadinessReviewRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.readiness.captureReview(input, idempotencyKey, request.user);
  }

  @Get("evidence")
  @RequirePermissions("operations.read")
  @ApiOperation({ summary: "List append-only backup and restore evidence" })
  list(
    @Query(new ZodValidationPipe(operationalEvidenceListQuerySchema))
    query: OperationalEvidenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.list(query, request.user);
  }

  @Post("evidence")
  @RequirePermissions("operations.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Record reviewed backup or restore evidence" })
  record(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(recordOperationalEvidenceRequestSchema))
    input: RecordOperationalEvidenceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.operations.record(input, idempotencyKey, request.user);
  }

  @Get("diagnostics")
  @RequirePermissions("operations.read")
  @ApiOperation({
    summary:
      "View safe database, outbox, sync, backup, and restore diagnostics",
  })
  diagnostics(@Req() request: AuthenticatedRequest) {
    return this.operations.diagnostics(request.user);
  }
}
