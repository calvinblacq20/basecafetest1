import {
  attachModifierGroupRequestSchema,
  createMenuItemRequestSchema,
  createMenuPriceRequestSchema,
  createMenuVariantRequestSchema,
  createModifierGroupRequestSchema,
  createStationRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  type AttachModifierGroupRequest,
  type CreateMenuItemRequest,
  type CreateMenuPriceRequest,
  type CreateMenuVariantRequest,
  type CreateModifierGroupRequest,
  type CreateStationRequest,
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
import { CatalogConfigurationService } from "./catalog-configuration.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("catalog")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("catalog")
// Configuration routes deliberately keep creation separate from activation.
export class CatalogConfigurationController {
  constructor(
    @Inject(CatalogConfigurationService)
    private readonly catalog: CatalogConfigurationService,
  ) {}

  @Get("branches/:branchId/stations")
  @RequirePermissions("catalog.read")
  @ApiOperation({ summary: "List production stations" })
  listStations(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.listStations(branchId, request.user);
  }

  @Get("branches/:branchId/tax-classes")
  @RequirePermissions("tax.read")
  @ApiOperation({ summary: "List active and inactive tax classifications" })
  listTaxClasses(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.listTaxClasses(branchId, request.user);
  }

  @Post("stations")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a production station idempotently" })
  createStation(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createStationRequestSchema))
    input: CreateStationRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.createStation(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Get("branches/:branchId/items")
  @RequirePermissions("catalog.read")
  @ApiOperation({ summary: "List menu items with catalog configuration" })
  listMenuItems(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.listMenuItems(branchId, request.user);
  }

  @Post("items")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive menu item idempotently" })
  createMenuItem(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createMenuItemRequestSchema))
    input: CreateMenuItemRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.createMenuItem(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("items/:menuItemId/variants")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive item variant idempotently" })
  createVariant(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createMenuVariantRequestSchema))
    input: CreateMenuVariantRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.createVariant(
      menuItemId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Get("branches/:branchId/modifier-groups")
  @RequirePermissions("catalog.read")
  @ApiOperation({ summary: "List modifier groups and modifiers" })
  listModifierGroups(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.listModifierGroups(branchId, request.user);
  }

  @Post("modifier-groups")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a modifier group with options" })
  createModifierGroup(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createModifierGroupRequestSchema))
    input: CreateModifierGroupRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.createModifierGroup(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("items/:menuItemId/modifier-groups/:modifierGroupId")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Attach a modifier group to a menu item" })
  attachModifierGroup(
    @Param("menuItemId", new ZodValidationPipe(identifierSchema))
    menuItemId: string,
    @Param("modifierGroupId", new ZodValidationPipe(identifierSchema))
    modifierGroupId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(attachModifierGroupRequestSchema))
    input: AttachModifierGroupRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.attachModifierGroup(
      menuItemId,
      modifierGroupId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("prices")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create a non-overlapping effective price" })
  createPrice(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createMenuPriceRequestSchema))
    input: CreateMenuPriceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.createPrice(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }
}
