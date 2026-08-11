import {
  activateRetentionPolicyRequestSchema,
  createCustomerRequestSchema,
  createPrivacyRequestSchema,
  createRetentionPolicyRequestSchema,
  customerDataAccessReasonSchema,
  customerSearchQuerySchema,
  idempotencyKeySchema,
  identifierSchema,
  privacyRequestListQuerySchema,
  recordCustomerConsentRequestSchema,
  retentionPreviewRequestSchema,
  transitionPrivacyRequestSchema,
  updateCustomerRequestSchema,
  type ActivateRetentionPolicyRequest,
  type CreateCustomerRequest,
  type CreatePrivacyRequest,
  type CreateRetentionPolicyRequest,
  type CustomerSearchQuery,
  type PrivacyRequestListQuery,
  type RecordCustomerConsentRequest,
  type RetentionPreviewRequest,
  type TransitionPrivacyRequest,
  type UpdateCustomerRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
import { PrivacyService } from "./privacy.service.js";

const parseKey = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);
const parseReason = (value: string | undefined) =>
  new ZodValidationPipe(customerDataAccessReasonSchema).transform(value);

@ApiTags("privacy")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller()
export class PrivacyController {
  constructor(
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
  ) {}

  @Post("customers")
  @RequirePermissions("customers.create")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Create an encrypted customer profile" })
  createCustomer(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createCustomerRequestSchema))
    input: CreateCustomerRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.createCustomer(input, parseKey(key), request.user);
  }

  @Get("customers/search")
  @RequirePermissions("customers.read", "customers.pii.read")
  @ApiHeader({ name: "X-Customer-Data-Reason", required: true })
  search(
    @Query(new ZodValidationPipe(customerSearchQuerySchema))
    query: CustomerSearchQuery,
    @Headers("x-customer-data-reason") reason: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.search(query, parseReason(reason), request.user);
  }

  @Get("customers/:customerId")
  @RequirePermissions("customers.read", "customers.pii.read")
  @ApiHeader({ name: "X-Customer-Data-Reason", required: true })
  getCustomer(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Headers("x-customer-data-reason") reason: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.getCustomer(
      customerId,
      parseReason(reason),
      request.user,
    );
  }

  @Patch("customers/:customerId")
  @RequirePermissions("customers.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  updateCustomer(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(updateCustomerRequestSchema))
    input: UpdateCustomerRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.updateCustomer(
      customerId,
      input,
      parseKey(key),
      request.user,
    );
  }

  @Get("customers/:customerId/export")
  @RequirePermissions("customer-data.export", "customers.pii.read")
  @ApiHeader({ name: "X-Customer-Data-Reason", required: true })
  exportCustomer(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Headers("x-customer-data-reason") reason: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.exportCustomer(
      customerId,
      parseReason(reason),
      request.user,
    );
  }

  @Post("customers/:customerId/consents")
  @RequirePermissions("customers.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  recordConsent(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(recordCustomerConsentRequestSchema))
    input: RecordCustomerConsentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.recordConsent(
      customerId,
      input,
      parseKey(key),
      request.user,
    );
  }

  @Get("customers/:customerId/consents")
  @RequirePermissions("customers.read")
  listConsents(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.listConsents(customerId, request.user);
  }

  @Post("customers/:customerId/privacy-requests")
  @RequirePermissions("privacy.requests.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createPrivacyRequest(
    @Param("customerId", new ZodValidationPipe(identifierSchema))
    customerId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createPrivacyRequestSchema))
    input: CreatePrivacyRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.createPrivacyRequest(
      customerId,
      input,
      parseKey(key),
      request.user,
    );
  }

  @Get("privacy-requests")
  @RequirePermissions("privacy.requests.read")
  listPrivacyRequests(
    @Query(new ZodValidationPipe(privacyRequestListQuerySchema))
    query: PrivacyRequestListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.listPrivacyRequests(query, request.user);
  }

  @Post("privacy-requests/:requestId/transition")
  @RequirePermissions("privacy.requests.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  transitionPrivacyRequest(
    @Param("requestId", new ZodValidationPipe(identifierSchema))
    requestId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(transitionPrivacyRequestSchema))
    input: TransitionPrivacyRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.transitionPrivacyRequest(
      requestId,
      input,
      parseKey(key),
      request.user,
    );
  }

  @Post("privacy/retention-policies")
  @RequirePermissions("privacy.policies.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createRetentionPolicy(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(createRetentionPolicyRequestSchema))
    input: CreateRetentionPolicyRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.createRetentionPolicy(
      input,
      parseKey(key),
      request.user,
    );
  }

  @Get("privacy/retention-policies")
  @RequirePermissions("privacy.policies.read")
  listRetentionPolicies(@Req() request: AuthenticatedRequest) {
    return this.privacy.listRetentionPolicies(request.user);
  }

  @Post("privacy/retention-policies/:policyId/activate")
  @RequirePermissions("privacy.policies.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  activateRetentionPolicy(
    @Param("policyId", new ZodValidationPipe(identifierSchema))
    policyId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(activateRetentionPolicyRequestSchema))
    input: ActivateRetentionPolicyRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.activateRetentionPolicy(
      policyId,
      input,
      parseKey(key),
      request.user,
    );
  }

  @Post("privacy/retention-preview")
  @RequirePermissions("privacy.policies.read")
  retentionPreview(
    @Body(new ZodValidationPipe(retentionPreviewRequestSchema))
    input: RetentionPreviewRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacy.retentionPreview(input, request.user);
  }
}
