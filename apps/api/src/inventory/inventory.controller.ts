import {
  activateRecipeVersionSchema,
  createInventoryItemSchema,
  createInventoryUnitConversionSchema,
  createInventoryUnitSchema,
  createRecipeVersionSchema,
  createStockCountSchema,
  createStockLocationSchema,
  idempotencyKeySchema,
  identifierSchema,
  inventoryBranchQuerySchema,
  inventoryConsumptionPreviewSchema,
  inventoryLedgerQuerySchema,
  postInventoryTransferSchema,
  postStockAdjustmentSchema,
  postStockCountSchema,
  type ActivateRecipeVersion,
  type CreateInventoryItem,
  type CreateInventoryUnit,
  type CreateInventoryUnitConversion,
  type CreateRecipeVersion,
  type CreateStockCount,
  type CreateStockLocation,
  type InventoryBranchQuery,
  type InventoryConsumptionPreview,
  type InventoryLedgerQuery,
  type PostInventoryTransfer,
  type PostStockAdjustment,
  type PostStockCount,
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
import { InventoryService } from "./inventory.service.js";

const commandKey = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("inventory")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("inventory")
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get("branches/:branchId/units")
  @RequirePermissions("inventory.read")
  listUnits(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listUnits(branchId, query, request.user);
  }

  @Get("branches/:branchId/locations")
  @RequirePermissions("inventory.read")
  listLocations(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listLocations(branchId, query, request.user);
  }

  @Get("branches/:branchId/items")
  @RequirePermissions("inventory.read")
  listItems(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listItems(branchId, query, request.user);
  }

  @Get("branches/:branchId/recipes")
  @RequirePermissions("inventory.read")
  listRecipes(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listRecipes(branchId, query, request.user);
  }

  @Get("branches/:branchId/ledger")
  @RequirePermissions("inventory.read")
  listLedger(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryLedgerQuerySchema))
    query: InventoryLedgerQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listLedger(branchId, query, request.user);
  }

  @Get("branches/:branchId/transfers")
  @RequirePermissions("inventory.read")
  listTransfers(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listTransfers(branchId, query, request.user);
  }

  @Get("branches/:branchId/counts")
  @RequirePermissions("inventory.read")
  listCounts(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryBranchQuerySchema))
    query: InventoryBranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.listCounts(branchId, query, request.user);
  }

  @Get("branches/:branchId/balances")
  @RequirePermissions("inventory.read")
  balances(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.balances(branchId, request.user);
  }

  @Post("units")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createUnit(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createInventoryUnitSchema))
    input: CreateInventoryUnit,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createUnit(input, commandKey(key), request.user);
  }

  @Post("unit-conversions")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createConversion(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createInventoryUnitConversionSchema))
    input: CreateInventoryUnitConversion,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createConversion(
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("locations")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createLocation(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createStockLocationSchema))
    input: CreateStockLocation,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createLocation(input, commandKey(key), request.user);
  }

  @Post("items")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createItem(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createInventoryItemSchema))
    input: CreateInventoryItem,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createItem(input, commandKey(key), request.user);
  }

  @Post("recipes")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createRecipe(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createRecipeVersionSchema))
    input: CreateRecipeVersion,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createRecipe(input, commandKey(key), request.user);
  }

  @Post("recipes/:recipeId/activate")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateRecipe(
    @Param("recipeId", new ZodValidationPipe(identifierSchema))
    recipeId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(activateRecipeVersionSchema))
    input: ActivateRecipeVersion,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.activateRecipe(
      recipeId,
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("adjustments")
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  adjustment(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(postStockAdjustmentSchema))
    input: PostStockAdjustment,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.postAdjustment(input, commandKey(key), request.user);
  }

  @Post("transfers")
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  transfer(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(postInventoryTransferSchema))
    input: PostInventoryTransfer,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.postTransfer(input, commandKey(key), request.user);
  }

  @Post("counts")
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createCount(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createStockCountSchema))
    input: CreateStockCount,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.createCount(input, commandKey(key), request.user);
  }

  @Post("counts/:countId/post")
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  postCount(
    @Param("countId", new ZodValidationPipe(identifierSchema)) countId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(postStockCountSchema)) input: PostStockCount,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.postCount(
      countId,
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("consumption-preview")
  @RequirePermissions("inventory.read")
  preview(
    @Body(new ZodValidationPipe(inventoryConsumptionPreviewSchema))
    input: InventoryConsumptionPreview,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventory.consumptionPreview(input, request.user);
  }
}
