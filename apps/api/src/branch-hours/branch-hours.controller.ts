import {
  branchScheduleLifecycleRequestSchema,
  createBranchScheduleRequestSchema,
  createSpecialHoursRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  resolveBranchHoursPreviewRequestSchema,
  updateBranchScheduleRequestSchema,
  updateSpecialHoursRequestSchema,
  type BranchScheduleLifecycleRequest,
  type CreateBranchScheduleRequest,
  type CreateSpecialHoursRequest,
  type ResolveBranchHoursPreviewRequest,
  type UpdateBranchScheduleRequest,
  type UpdateSpecialHoursRequest,
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
import { BranchHoursService } from "./branch-hours.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("branch hours")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("branch-schedules")
export class BranchHoursController {
  constructor(
    @Inject(BranchHoursService) private readonly hours: BranchHoursService,
  ) {}

  @Get("branches/:branchId")
  @RequirePermissions("branch-hours.read")
  @ApiOperation({ summary: "List branch schedule and special-hours versions" })
  listConfiguration(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.listConfiguration(branchId, request.user);
  }

  @Post()
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a draft weekly branch schedule" })
  createSchedule(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createBranchScheduleRequestSchema))
    input: CreateBranchScheduleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.createSchedule(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":scheduleId/update")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update a draft branch schedule" })
  updateSchedule(
    @Param("scheduleId", new ZodValidationPipe(identifierSchema))
    scheduleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateBranchScheduleRequestSchema))
    input: UpdateBranchScheduleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.updateSchedule(
      scheduleId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":scheduleId/activate")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate an effective-dated schedule version" })
  activateSchedule(
    @Param("scheduleId", new ZodValidationPipe(identifierSchema))
    scheduleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(branchScheduleLifecycleRequestSchema))
    input: BranchScheduleLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.activateSchedule(
      scheduleId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":scheduleId/cancel")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Cancel a future active schedule version" })
  cancelSchedule(
    @Param("scheduleId", new ZodValidationPipe(identifierSchema))
    scheduleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(branchScheduleLifecycleRequestSchema))
    input: BranchScheduleLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.cancelSchedule(
      scheduleId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("special-days")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a draft closure or custom-hours version" })
  createSpecialHours(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createSpecialHoursRequestSchema))
    input: CreateSpecialHoursRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.createSpecialHours(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("special-days/:specialHoursId/update")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update draft special hours" })
  updateSpecialHours(
    @Param("specialHoursId", new ZodValidationPipe(identifierSchema))
    specialHoursId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateSpecialHoursRequestSchema))
    input: UpdateSpecialHoursRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.updateSpecialHours(
      specialHoursId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("special-days/:specialHoursId/activate")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate and supersede special hours for a date" })
  activateSpecialHours(
    @Param("specialHoursId", new ZodValidationPipe(identifierSchema))
    specialHoursId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(branchScheduleLifecycleRequestSchema))
    input: BranchScheduleLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.activateSpecialHours(
      specialHoursId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("special-days/:specialHoursId/cancel")
  @RequirePermissions("branch-hours.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Cancel active current or future special hours" })
  cancelSpecialHours(
    @Param("specialHoursId", new ZodValidationPipe(identifierSchema))
    specialHoursId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(branchScheduleLifecycleRequestSchema))
    input: BranchScheduleLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.cancelSpecialHours(
      specialHoursId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("resolve-preview")
  @RequirePermissions("branch-hours.read")
  @ApiOperation({ summary: "Resolve local open state and business date" })
  resolvePreview(
    @Body(new ZodValidationPipe(resolveBranchHoursPreviewRequestSchema))
    input: ResolveBranchHoursPreviewRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.hours.resolvePreview(input, request.user);
  }
}
