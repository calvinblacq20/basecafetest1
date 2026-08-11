import {
  createCategoryRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  type CreateCategoryRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Headers,
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
import { CatalogService } from "./catalog.service.js";

@ApiTags("catalog")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("catalog")
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalogService: CatalogService,
  ) {}

  @Get("branches/:branchId/categories")
  @RequirePermissions("catalog.read")
  @ApiOperation({ summary: "List active and inactive menu categories" })
  listCategories(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalogService.listCategories(branchId, request.user);
  }

  @Post("categories")
  @RequirePermissions("catalog.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "A unique retry key, 16–200 safe characters",
  })
  @ApiOperation({ summary: "Create a menu category idempotently" })
  createCategory(
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createCategoryRequestSchema))
    input: CreateCategoryRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedIdempotencyKey = new ZodValidationPipe(
      idempotencyKeySchema,
    ).transform(idempotencyKey);
    return this.catalogService.createCategory(
      input,
      parsedIdempotencyKey,
      request.user,
    );
  }
}
