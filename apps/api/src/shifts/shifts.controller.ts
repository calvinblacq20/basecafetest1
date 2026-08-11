import {
  closeShiftRequestSchema,
  handoverShiftRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  openShiftRequestSchema,
  type CloseShiftRequest,
  type HandoverShiftRequest,
  type OpenShiftRequest,
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
import { ShiftsService } from "./shifts.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("staff shifts")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("shifts")
export class ShiftsController {
  constructor(@Inject(ShiftsService) private readonly shifts: ShiftsService) {}

  @Get("branches/:branchId")
  @RequirePermissions("shifts.read")
  @ApiOperation({ summary: "List recent branch shifts" })
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.list(branchId, request.user);
  }

  @Get("branches/:branchId/current")
  @RequirePermissions("shifts.read")
  @ApiOperation({ summary: "Get the open shift for the authenticated device" })
  current(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.current(branchId, request.user);
  }

  @Get("branches/:branchId/:shiftId")
  @RequirePermissions("shifts.read")
  @ApiOperation({
    summary: "Get a shift with responsibility and close history",
  })
  get(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("shiftId", new ZodValidationPipe(identifierSchema)) shiftId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.get(shiftId, branchId, request.user);
  }

  @Post("open")
  @RequirePermissions("shifts.open")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Open a device-bound cashier shift" })
  open(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(openShiftRequestSchema))
    input: OpenShiftRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.open(input, parseIdempotencyKey(key), request.user);
  }

  @Post(":shiftId/handover")
  @RequirePermissions("shifts.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Hand an open shift to another authorized cashier" })
  handover(
    @Param("shiftId", new ZodValidationPipe(identifierSchema)) shiftId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(handoverShiftRequestSchema))
    input: HandoverShiftRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.handover(
      shiftId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":shiftId/close")
  @RequirePermissions("shifts.close")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Close a shift with an immutable cash-count snapshot",
  })
  close(
    @Param("shiftId", new ZodValidationPipe(identifierSchema)) shiftId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(closeShiftRequestSchema))
    input: CloseShiftRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.shifts.close(
      shiftId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
}
