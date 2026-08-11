import {
  activateInventoryConsumptionRouteSchema,
  activateInventoryDeductionPolicySchema,
  confirmInventoryDeductionPolicySchema,
  createInventoryConsumptionRouteSchema,
  createInventoryDeductionPolicySchema,
  idempotencyKeySchema,
  identifierSchema,
  inventoryConsumptionCommandSchema,
  inventoryConsumptionListQuerySchema,
  postInventoryConsumptionSchema,
  reverseInventoryConsumptionSchema,
  type ActivateInventoryConsumptionRoute,
  type ActivateInventoryDeductionPolicy,
  type ConfirmInventoryDeductionPolicy,
  type CreateInventoryConsumptionRoute,
  type CreateInventoryDeductionPolicy,
  type InventoryConsumptionCommand,
  type InventoryConsumptionListQuery,
  type PostInventoryConsumption,
  type ReverseInventoryConsumption,
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
import { InventoryConsumptionService } from "./inventory-consumption.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("inventory-consumption")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("inventory-consumption")
export class InventoryConsumptionController {
  constructor(
    @Inject(InventoryConsumptionService)
    private readonly consumption: InventoryConsumptionService,
  ) {}

  @Get("branches/:branchId/policies")
  @RequirePermissions("inventory.read")
  policies(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.listPolicies(branchId, request.user);
  }

  @Get("branches/:branchId/routes")
  @RequirePermissions("inventory.read")
  routes(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.listRoutes(branchId, request.user);
  }

  @Get("branches/:branchId")
  @RequirePermissions("inventory.read")
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(inventoryConsumptionListQuerySchema))
    query: InventoryConsumptionListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.listConsumptions(branchId, query, request.user);
  }

  @Get("branches/:branchId/reconciliation")
  @RequirePermissions("inventory.read")
  reconciliation(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.reconciliation(branchId, request.user);
  }

  @Post("policies")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createPolicy(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createInventoryDeductionPolicySchema))
    input: CreateInventoryDeductionPolicy,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.createPolicy(input, key(value), request.user);
  }

  @Post("policies/:policyId/confirm")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  confirmPolicy(
    @Param("policyId", new ZodValidationPipe(identifierSchema))
    policyId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(confirmInventoryDeductionPolicySchema))
    input: ConfirmInventoryDeductionPolicy,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.confirmPolicy(
      policyId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("policies/:policyId/activate")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activatePolicy(
    @Param("policyId", new ZodValidationPipe(identifierSchema))
    policyId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(activateInventoryDeductionPolicySchema))
    input: ActivateInventoryDeductionPolicy,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.activatePolicy(
      policyId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("routes")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createRoute(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createInventoryConsumptionRouteSchema))
    input: CreateInventoryConsumptionRoute,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.createRoute(input, key(value), request.user);
  }

  @Post("routes/:routeId/activate")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateRoute(
    @Param("routeId", new ZodValidationPipe(identifierSchema)) routeId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(activateInventoryConsumptionRouteSchema))
    input: ActivateInventoryConsumptionRoute,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.activateRoute(
      routeId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("preview")
  @RequirePermissions("inventory.read")
  preview(
    @Body(new ZodValidationPipe(inventoryConsumptionCommandSchema))
    input: InventoryConsumptionCommand,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.preview(input, request.user);
  }

  @Post()
  @RequirePermissions("inventory.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  postConsumption(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(postInventoryConsumptionSchema))
    input: PostInventoryConsumption,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.post(input, key(value), request.user);
  }

  @Post(":consumptionId/reverse")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  reverse(
    @Param("consumptionId", new ZodValidationPipe(identifierSchema))
    consumptionId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(reverseInventoryConsumptionSchema))
    input: ReverseInventoryConsumption,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.consumption.reverse(
      consumptionId,
      input,
      key(value),
      request.user,
    );
  }
}
