import {
  activateBatchRecipeVersionSchema,
  activateModifierRecipeEffectSchema,
  batchProductionPreviewSchema,
  createBatchRecipeVersionSchema,
  createModifierRecipeEffectSchema,
  idempotencyKeySchema,
  identifierSchema,
  inventoryProductionListQuerySchema,
  postBatchProductionSchema,
  reverseBatchProductionSchema,
  type ActivateBatchRecipeVersion,
  type ActivateModifierRecipeEffect,
  type BatchProductionPreview,
  type CreateBatchRecipeVersion,
  type CreateModifierRecipeEffect,
  type InventoryProductionListQuery,
  type PostBatchProduction,
  type ReverseBatchProduction,
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
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { InventoryProductionService } from "./inventory-production.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("inventory-production")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("inventory-production")
export class InventoryProductionController {
  constructor(
    @Inject(InventoryProductionService)
    private readonly production: InventoryProductionService,
  ) {}

  @Get("branches/:branchId/modifier-effects")
  @RequirePermissions("inventory.read")
  modifierEffects(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.listModifierEffects(branchId, request.user);
  }

  @Get("branches/:branchId/batch-recipes")
  @RequirePermissions("inventory.read")
  batchRecipes(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.listBatchRecipes(branchId, request.user);
  }

  @Get("branches/:branchId/batches")
  @RequirePermissions("inventory.read")
  batches(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryProductionListQuerySchema))
    query: InventoryProductionListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.listProductions(branchId, query, request.user);
  }

  @Post("modifier-effects")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createModifierEffect(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createModifierRecipeEffectSchema))
    input: CreateModifierRecipeEffect,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.createModifierEffect(
      input,
      key(value),
      request.user,
    );
  }

  @Post("modifier-effects/:effectId/activate")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateModifierEffect(
    @Param("effectId", new ZodValidationPipe(identifierSchema))
    effectId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(activateModifierRecipeEffectSchema))
    input: ActivateModifierRecipeEffect,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.activateModifierEffect(
      effectId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("batch-recipes")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createBatchRecipe(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createBatchRecipeVersionSchema))
    input: CreateBatchRecipeVersion,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.createBatchRecipe(input, key(value), request.user);
  }

  @Post("batch-recipes/:recipeId/activate")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateBatchRecipe(
    @Param("recipeId", new ZodValidationPipe(identifierSchema))
    recipeId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(activateBatchRecipeVersionSchema))
    input: ActivateBatchRecipeVersion,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.activateBatchRecipe(
      recipeId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("batches/preview")
  @RequirePermissions("inventory.read")
  preview(
    @Body(new ZodValidationPipe(batchProductionPreviewSchema))
    input: BatchProductionPreview,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.preview(input, request.user);
  }

  @Post("batches")
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  postBatch(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(postBatchProductionSchema))
    input: PostBatchProduction,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.post(input, key(value), request.user);
  }

  @Post("batches/:productionId/reverse")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  reverseBatch(
    @Param("productionId", new ZodValidationPipe(identifierSchema))
    productionId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(reverseBatchProductionSchema))
    input: ReverseBatchProduction,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.reverse(
      productionId,
      input,
      key(value),
      request.user,
    );
  }
}
