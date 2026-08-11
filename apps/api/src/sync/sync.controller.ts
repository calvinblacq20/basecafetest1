import {
  identifierSchema,
  idempotencyKeySchema,
  resolveSyncCommandRequestSchema,
  syncBatchRequestSchema,
  type ResolveSyncCommandRequest,
  type SyncBatchRequest,
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
import { SyncBootstrapService } from "./sync-bootstrap.service.js";
import { SyncRecoveryService } from "./sync-recovery.service.js";
import { SyncService } from "./sync.service.js";

@ApiTags("sync")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("sync")
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(SyncBootstrapService)
    private readonly bootstrapService: SyncBootstrapService,
    @Inject(SyncRecoveryService)
    private readonly recoveryService: SyncRecoveryService,
  ) {}

  @Get("bootstrap/:branchId")
  @ApiOperation({
    summary: "Load a safe device-scoped offline working snapshot",
  })
  bootstrap(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bootstrapService.load(branchId, request.user);
  }

  @Post("batch")
  @ApiOperation({
    summary: "Replay an ordered batch of offline-safe domain commands",
  })
  batch(
    @Body(new ZodValidationPipe(syncBatchRequestSchema))
    input: SyncBatchRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sync.batch(input, request.user);
  }
  @Get("recovery/:branchId")
  @RequirePermissions("sync.recovery.read")
  @ApiOperation({ summary: "List unresolved terminal sync commands" })
  recovery(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.recoveryService.list(branchId, request.user);
  }

  @Post("commands/:commandId/resolve")
  @RequirePermissions("sync.recovery.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Append a manager resolution to a terminal sync command",
  })
  resolve(
    @Param("commandId", new ZodValidationPipe(identifierSchema))
    commandId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(resolveSyncCommandRequestSchema))
    input: ResolveSyncCommandRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const idempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(key);
    return this.recoveryService.resolve(
      commandId,
      input,
      idempotencyKey,
      request.user,
    );
  }
}
