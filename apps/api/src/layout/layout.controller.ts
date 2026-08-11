import {
  createDiningAreaRequestSchema,
  createDiningTableRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  layoutLifecycleRequestSchema,
  updateDiningAreaRequestSchema,
  updateDiningTableRequestSchema,
  type CreateDiningAreaRequest,
  type CreateDiningTableRequest,
  type LayoutLifecycleRequest,
  type UpdateDiningAreaRequest,
  type UpdateDiningTableRequest,
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
import { LayoutService } from "./layout.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("dining layout")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("layout")
export class LayoutController {
  constructor(@Inject(LayoutService) private readonly layout: LayoutService) {}

  @Get("branches/:branchId/areas")
  @RequirePermissions("layout.read")
  @ApiOperation({ summary: "List dining areas with their configured tables" })
  listAreas(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.listAreas(branchId, request.user);
  }

  @Get("branches/:branchId/tables")
  @RequirePermissions("layout.read")
  @ApiOperation({ summary: "List branch tables with their dining areas" })
  listTables(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.listTables(branchId, request.user);
  }

  @Post("areas")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive dining area" })
  createArea(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createDiningAreaRequestSchema))
    input: CreateDiningAreaRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.createArea(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("areas/:areaId/update")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update a dining area with optimistic revision" })
  updateArea(
    @Param("areaId", new ZodValidationPipe(identifierSchema)) areaId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateDiningAreaRequestSchema))
    input: UpdateDiningAreaRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.updateArea(
      areaId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("areas/:areaId/activate")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate a dining area" })
  activateArea(
    @Param("areaId", new ZodValidationPipe(identifierSchema)) areaId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(layoutLifecycleRequestSchema))
    input: LayoutLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.activateArea(
      areaId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("areas/:areaId/deactivate")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Deactivate an area after its active tables" })
  deactivateArea(
    @Param("areaId", new ZodValidationPipe(identifierSchema)) areaId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(layoutLifecycleRequestSchema))
    input: LayoutLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.deactivateArea(
      areaId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("tables")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive table in a dining area" })
  createTable(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createDiningTableRequestSchema))
    input: CreateDiningTableRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.createTable(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("tables/:tableId/update")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update table capacity, area, order, or position" })
  updateTable(
    @Param("tableId", new ZodValidationPipe(identifierSchema)) tableId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateDiningTableRequestSchema))
    input: UpdateDiningTableRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.updateTable(
      tableId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("tables/:tableId/activate")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate a table inside an active dining area" })
  activateTable(
    @Param("tableId", new ZodValidationPipe(identifierSchema)) tableId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(layoutLifecycleRequestSchema))
    input: LayoutLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.activateTable(
      tableId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("tables/:tableId/deactivate")
  @RequirePermissions("layout.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Deactivate a table for new dine-in orders" })
  deactivateTable(
    @Param("tableId", new ZodValidationPipe(identifierSchema)) tableId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(layoutLifecycleRequestSchema))
    input: LayoutLifecycleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.layout.deactivateTable(
      tableId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
}
