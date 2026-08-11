import {
  activateDeviceRequestSchema,
  assignStaffRoleRequestSchema,
  createDeviceRequestSchema,
  createRoleRequestSchema,
  createStaffRequestSchema,
  disableStaffRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  reactivateStaffRequestSchema,
  removeStaffRoleRequestSchema,
  revokeDeviceRequestSchema,
  type ActivateDeviceRequest,
  type AssignStaffRoleRequest,
  type CreateDeviceRequest,
  type CreateRoleRequest,
  type CreateStaffRequest,
  type DisableStaffRequest,
  type ReactivateStaffRequest,
  type RemoveStaffRoleRequest,
  type RevokeDeviceRequest,
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
import { AdministrationService } from "./administration.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("administration")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("administration")
export class AdministrationController {
  constructor(
    @Inject(AdministrationService)
    private readonly administration: AdministrationService,
  ) {}

  @Get("branches/:branchId/permissions")
  @RequirePermissions("roles.manage")
  @ApiOperation({ summary: "List registered permission keys" })
  listPermissions(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.listPermissions(branchId, request.user);
  }

  @Get("branches/:branchId/roles")
  @RequirePermissions("roles.manage")
  @ApiOperation({ summary: "List configurable organization roles" })
  listRoles(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.listRoles(branchId, request.user);
  }

  @Post("roles")
  @RequirePermissions("roles.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a role without privilege escalation" })
  createRole(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createRoleRequestSchema))
    input: CreateRoleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.createRole(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Get("branches/:branchId/staff")
  @RequirePermissions("staff.manage")
  @ApiOperation({ summary: "List staff visible in a branch" })
  listStaff(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.listStaff(branchId, request.user);
  }

  @Post("staff")
  @RequirePermissions("staff.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an individually attributed staff account" })
  createStaff(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createStaffRequestSchema))
    input: CreateStaffRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.createStaff(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("staff/:userId/roles")
  @RequirePermissions("staff.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Assign an additional audited staff role" })
  assignStaffRole(
    @Param("userId", new ZodValidationPipe(identifierSchema)) userId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(assignStaffRoleRequestSchema))
    input: AssignStaffRoleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.assignStaffRole(
      userId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("staff/:userId/roles/:assignmentId/remove")
  @RequirePermissions("staff.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Revoke a role assignment without deleting history",
  })
  removeStaffRole(
    @Param("userId", new ZodValidationPipe(identifierSchema)) userId: string,
    @Param("assignmentId", new ZodValidationPipe(identifierSchema))
    assignmentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(removeStaffRoleRequestSchema))
    input: RemoveStaffRoleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.removeStaffRole(
      userId,
      assignmentId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
  @Post("staff/:userId/disable")
  @RequirePermissions("staff.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Disable staff and revoke active sessions" })
  disableStaff(
    @Param("userId", new ZodValidationPipe(identifierSchema)) userId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(disableStaffRequestSchema))
    input: DisableStaffRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.disableStaff(
      userId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("staff/:userId/reactivate")
  @RequirePermissions("staff.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Reactivate staff and require password replacement",
  })
  reactivateStaff(
    @Param("userId", new ZodValidationPipe(identifierSchema)) userId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(reactivateStaffRequestSchema))
    input: ReactivateStaffRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.reactivateStaff(
      userId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
  @Get("branches/:branchId/devices")
  @RequirePermissions("device.manage")
  @ApiOperation({ summary: "List branch devices without fingerprint hashes" })
  listDevices(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.listDevices(branchId, request.user);
  }

  @Post("devices")
  @RequirePermissions("device.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Register a pending branch device" })
  createDevice(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createDeviceRequestSchema))
    input: CreateDeviceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.createDevice(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("devices/:deviceId/activate")
  @RequirePermissions("device.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Approve and bind a pending device" })
  activateDevice(
    @Param("deviceId", new ZodValidationPipe(identifierSchema))
    deviceId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(activateDeviceRequestSchema))
    input: ActivateDeviceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.activateDevice(
      deviceId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("devices/:deviceId/revoke")
  @RequirePermissions("device.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Revoke a device and its active sessions" })
  revokeDevice(
    @Param("deviceId", new ZodValidationPipe(identifierSchema))
    deviceId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(revokeDeviceRequestSchema))
    input: RevokeDeviceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.administration.revokeDevice(
      deviceId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
}
