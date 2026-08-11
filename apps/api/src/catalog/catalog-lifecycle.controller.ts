import {
  activateTaxClassRequestSchema,
  catalogRevisionCommandSchema,
  createTaxClassRequestSchema,
  deactivateCatalogRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  updateMenuItemRequestSchema,
  type ActivateTaxClassRequest,
  type CatalogRevisionCommand,
  type CreateTaxClassRequest,
  type DeactivateCatalogRequest,
  type UpdateMenuItemRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Patch,
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
import { CatalogLifecycleService } from "./catalog-lifecycle.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("catalog")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("catalog")
export class CatalogLifecycleController {
  constructor(
    @Inject(CatalogLifecycleService)
    private readonly lifecycle: CatalogLifecycleService,
  ) {}

  @Post("tax-classes")
  @RequirePermissions("tax.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive tax classification" })
  createTaxClass(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createTaxClassRequestSchema))
    input: CreateTaxClassRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.createTaxClass(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("tax-classes/:taxClassId/activate")
  @RequirePermissions("tax.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate an approved tax classification" })
  activateTaxClass(
    @Param("taxClassId", new ZodValidationPipe(identifierSchema))
    taxClassId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(activateTaxClassRequestSchema))
    input: ActivateTaxClassRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.activateTaxClass(
      taxClassId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Patch("items/:menuItemId")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update a menu item with revision checking" })
  updateMenuItem(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateMenuItemRequestSchema))
    input: UpdateMenuItemRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.updateMenuItem(
      menuItemId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("items/:menuItemId/activate")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate a fully configured menu item" })
  activateMenuItem(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(catalogRevisionCommandSchema))
    input: CatalogRevisionCommand,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.activateMenuItem(
      menuItemId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("items/:menuItemId/deactivate")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Deactivate a menu item with an audit reason" })
  deactivateMenuItem(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(deactivateCatalogRequestSchema))
    input: DeactivateCatalogRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.deactivateMenuItem(
      menuItemId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("items/:menuItemId/variants/:variantId/activate")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate a priced variant" })
  activateVariant(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Param("variantId", new ZodValidationPipe(identifierSchema))
    variantId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(catalogRevisionCommandSchema))
    input: CatalogRevisionCommand,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.activateVariant(
      menuItemId,
      variantId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
}
