import {
  activateTaxProfileRequestSchema,
  confirmTaxProfileRequestSchema,
  createTaxProfileRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  taxCalculationPreviewRequestSchema,
  updateTaxProfileRequestSchema,
  type ActivateTaxProfileRequest,
  type ConfirmTaxProfileRequest,
  type CreateTaxProfileRequest,
  type TaxCalculationPreviewRequest,
  type UpdateTaxProfileRequest,
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
import { TaxService } from "./tax.service.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("tax profiles")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("tax-profiles")
export class TaxController {
  constructor(@Inject(TaxService) private readonly tax: TaxService) {}

  @Get("branches/:branchId")
  @RequirePermissions("tax.read")
  @ApiOperation({ summary: "List effective-dated branch tax profiles" })
  listProfiles(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.listProfiles(branchId, request.user);
  }

  @Post()
  @RequirePermissions("tax.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an inactive draft tax profile" })
  createProfile(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createTaxProfileRequestSchema))
    input: CreateTaxProfileRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.createProfile(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":profileId/update")
  @RequirePermissions("tax.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Update a draft tax profile with revision history" })
  updateProfile(
    @Param("profileId", new ZodValidationPipe(identifierSchema))
    profileId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateTaxProfileRequestSchema))
    input: UpdateTaxProfileRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.updateProfile(
      profileId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":profileId/confirm")
  @RequirePermissions("tax.approve")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Record external approval evidence and freeze rates",
  })
  confirmProfile(
    @Param("profileId", new ZodValidationPipe(identifierSchema))
    profileId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(confirmTaxProfileRequestSchema))
    input: ConfirmTaxProfileRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.confirmProfile(
      profileId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":profileId/activate")
  @RequirePermissions("tax.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Activate a confirmed non-overlapping profile" })
  activateProfile(
    @Param("profileId", new ZodValidationPipe(identifierSchema))
    profileId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(activateTaxProfileRequestSchema))
    input: ActivateTaxProfileRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.activateProfile(
      profileId,
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post(":profileId/calculate-preview")
  @RequirePermissions("tax.read")
  @ApiOperation({ summary: "Preview integer-pesewa tax calculation" })
  previewCalculation(
    @Param("profileId", new ZodValidationPipe(identifierSchema))
    profileId: string,
    @Body(new ZodValidationPipe(taxCalculationPreviewRequestSchema))
    input: TaxCalculationPreviewRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tax.previewCalculation(profileId, input, request.user);
  }
}
