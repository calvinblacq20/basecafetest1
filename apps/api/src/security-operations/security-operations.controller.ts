import {
  evaluateSecurityMonitoringRequestSchema,
  idempotencyKeySchema,
  legacyCustomerPiiPreviewRequestSchema,
  revokeSecuritySessionRequestSchema,
  rewrapCustomerPiiRequestSchema,
  securityAlertListQuerySchema,
  securitySessionListQuerySchema,
  transitionSecurityAlertRequestSchema,
  type EvaluateSecurityMonitoringRequest,
  type LegacyCustomerPiiPreviewRequest,
  type RevokeSecuritySessionRequest,
  type RewrapCustomerPiiRequest,
  type SecurityAlertListQuery,
  type SecuritySessionListQuery,
  type TransitionSecurityAlertRequest,
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
import { SecurityOperationsService } from "./security-operations.service.js";

@ApiTags("security operations")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("security")
export class SecurityOperationsController {
  constructor(
    @Inject(SecurityOperationsService)
    private readonly security: SecurityOperationsService,
  ) {}

  @Get("alerts")
  @RequirePermissions("security.alerts.read")
  @ApiOperation({ summary: "List deduplicated security alerts" })
  alerts(
    @Query(new ZodValidationPipe(securityAlertListQuerySchema))
    query: SecurityAlertListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.listAlerts(query, request.user);
  }

  @Post("monitoring/evaluate")
  @RequirePermissions("security.alerts.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Evaluate safe internal security signals" })
  evaluate(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(evaluateSecurityMonitoringRequestSchema))
    input: EvaluateSecurityMonitoringRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.evaluate(input, this.key(key), request.user);
  }

  @Post("alerts/:alertId/acknowledge")
  @RequirePermissions("security.alerts.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Acknowledge an open security alert" })
  acknowledge(
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(transitionSecurityAlertRequestSchema))
    input: TransitionSecurityAlertRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.acknowledgeAlert(
      alertId,
      input,
      this.key(key),
      request.user,
    );
  }

  @Post("alerts/:alertId/resolve")
  @RequirePermissions("security.alerts.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Resolve an acknowledged security alert" })
  resolve(
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(transitionSecurityAlertRequestSchema))
    input: TransitionSecurityAlertRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.resolveAlert(
      alertId,
      input,
      this.key(key),
      request.user,
    );
  }

  @Get("sessions")
  @RequirePermissions("security.sessions.read")
  @ApiOperation({ summary: "List safe active and historical session metadata" })
  sessions(
    @Query(new ZodValidationPipe(securitySessionListQuerySchema))
    query: SecuritySessionListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.listSessions(query, request.user);
  }

  @Post("sessions/:sessionId/revoke")
  @RequirePermissions("security.sessions.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Revoke one staff session immediately" })
  revokeSession(
    @Param("sessionId") sessionId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(revokeSecuritySessionRequestSchema))
    input: RevokeSecuritySessionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.revokeSession(
      sessionId,
      input,
      this.key(key),
      request.user,
    );
  }

  @Get("privacy/key-posture")
  @RequirePermissions("privacy.keys.read")
  @ApiOperation({
    summary: "View PII envelope-key posture without key material",
  })
  keyPosture(@Req() request: AuthenticatedRequest) {
    return this.security.keyPosture(request.user);
  }

  @Post("privacy/key-rotation/rewrap")
  @RequirePermissions("privacy.keys.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Rewrap a bounded batch of customer PII envelopes" })
  rewrap(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(rewrapCustomerPiiRequestSchema))
    input: RewrapCustomerPiiRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.rewrapCustomerPii(input, this.key(key), request.user);
  }

  @Post("privacy/legacy-migration-preview")
  @RequirePermissions("privacy.keys.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Dry-run the bounded legacy-PII migration inventory",
  })
  legacyPreview(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(legacyCustomerPiiPreviewRequestSchema))
    input: LegacyCustomerPiiPreviewRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.security.legacyPiiPreview(input, this.key(key), request.user);
  }

  private key(value: string | undefined) {
    return new ZodValidationPipe(idempotencyKeySchema).transform(value);
  }
}
