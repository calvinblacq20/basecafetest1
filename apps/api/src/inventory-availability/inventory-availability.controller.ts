import {
  availabilityHistoryQuerySchema,
  availabilityPreviewSchema,
  confirmCriticalIngredientRuleSchema,
  createCriticalIngredientRuleSchema,
  criticalIngredientRuleRevisionSchema,
  idempotencyKeySchema,
  identifierSchema,
  recordManualAvailabilitySchema,
  type AvailabilityHistoryQuery,
  type AvailabilityPreview,
  type ConfirmCriticalIngredientRule,
  type CreateCriticalIngredientRule,
  type CriticalIngredientRuleRevision,
  type RecordManualAvailability,
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
import { InventoryAvailabilityService } from "./inventory-availability.service.js";

const commandKey = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("inventory-availability")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("inventory-availability")
export class InventoryAvailabilityController {
  constructor(
    @Inject(InventoryAvailabilityService)
    private readonly availability: InventoryAvailabilityService,
  ) {}

  @Get("branches/:branchId/rules")
  @RequirePermissions("inventory.read")
  rules(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.listRules(branchId, request.user);
  }

  @Get("branches/:branchId/manual-history")
  @RequirePermissions("catalog.availability.read")
  manualHistory(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(availabilityHistoryQuerySchema))
    query: AvailabilityHistoryQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.listManualHistory(branchId, query, request.user);
  }

  @Post("preview")
  @RequirePermissions("catalog.availability.read")
  preview(
    @Body(new ZodValidationPipe(availabilityPreviewSchema))
    input: AvailabilityPreview,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.preview(input, request.user);
  }

  @Post("rules")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createRule(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createCriticalIngredientRuleSchema))
    input: CreateCriticalIngredientRule,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.createRule(input, commandKey(key), request.user);
  }

  @Post("rules/:ruleId/confirm")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  confirmRule(
    @Param("ruleId", new ZodValidationPipe(identifierSchema)) ruleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(confirmCriticalIngredientRuleSchema))
    input: ConfirmCriticalIngredientRule,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.confirmRule(
      ruleId,
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("rules/:ruleId/activate")
  @RequirePermissions("inventory.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateRule(
    @Param("ruleId", new ZodValidationPipe(identifierSchema)) ruleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(criticalIngredientRuleRevisionSchema))
    input: CriticalIngredientRuleRevision,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.activateRule(
      ruleId,
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("rules/:ruleId/cancel")
  @RequirePermissions("inventory.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  cancelRule(
    @Param("ruleId", new ZodValidationPipe(identifierSchema)) ruleId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(criticalIngredientRuleRevisionSchema))
    input: CriticalIngredientRuleRevision,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.cancelRule(
      ruleId,
      input,
      commandKey(key),
      request.user,
    );
  }

  @Post("manual-events")
  @RequirePermissions("catalog.availability.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  recordManual(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(recordManualAvailabilitySchema))
    input: RecordManualAvailability,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.availability.recordManual(input, commandKey(key), request.user);
  }
}
