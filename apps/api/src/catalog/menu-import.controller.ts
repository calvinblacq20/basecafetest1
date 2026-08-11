import {
  idempotencyKeySchema,
  identifierSchema,
  menuImportApplyRequestSchema,
  menuImportDryRunRequestSchema,
  type MenuImportApplyRequest,
  type MenuImportDryRunRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Header,
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
import { MenuImportService } from "./menu-import.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("catalog imports")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("catalog/imports")
export class MenuImportController {
  constructor(
    @Inject(MenuImportService)
    private readonly menuImports: MenuImportService,
  ) {}

  @Post("menu/dry-run")
  @RequirePermissions("catalog.import")
  @ApiOperation({ summary: "Validate every menu CSV row without writing data" })
  dryRun(
    @Body(new ZodValidationPipe(menuImportDryRunRequestSchema))
    input: MenuImportDryRunRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.menuImports.dryRun(input, request.user);
  }

  @Post("menu/apply")
  @RequirePermissions("catalog.import")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Atomically apply a previously validated menu CSV" })
  apply(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(menuImportApplyRequestSchema))
    input: MenuImportApplyRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.menuImports.apply(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Get("branches/:branchId/:importId")
  @RequirePermissions("catalog.import")
  @ApiOperation({ summary: "Download a stored menu import result as JSON" })
  @Header(
    "Content-Disposition",
    'attachment; filename="catalog-import-result.json"',
  )
  getResult(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("importId", new ZodValidationPipe(identifierSchema))
    importId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.menuImports.getResult(branchId, importId, request.user);
  }
}
