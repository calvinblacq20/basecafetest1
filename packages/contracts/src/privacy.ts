import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);
const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

export const customerProfileStatusSchema = z.enum([
  "ACTIVE",
  "RESTRICTED",
  "ANONYMIZED",
]);
export const customerContactChannelSchema = z.enum([
  "PHONE",
  "SMS",
  "EMAIL",
  "WHATSAPP",
]);
export const customerConsentPurposeSchema = z.enum([
  "OPERATIONAL_CONTACT",
  "MARKETING",
]);
export const customerConsentStatusSchema = z.enum(["GRANTED", "WITHDRAWN"]);
export const privacyRequestTypeSchema = z.enum([
  "ACCESS",
  "CORRECTION",
  "RESTRICTION",
  "ANONYMIZATION",
]);
export const privacyRequestStatusSchema = z.enum([
  "RECEIVED",
  "IDENTITY_VERIFIED",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
]);
export const retentionCategorySchema = z.enum([
  "CUSTOMER_PROFILE",
  "ORDER_CONTACT",
  "DELIVERY_DIRECTIONS",
]);
export const retentionPolicyStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "CANCELLED",
]);

const customerPiiFields = {
  displayName: optionalText(160),
  phone: optionalText(40),
  email: z.string().trim().email().max(254).nullable().optional(),
  notes: optionalText(1_000),
  preferredContactChannel: customerContactChannelSchema.nullable().optional(),
};

function requireCustomerIdentity(
  value: {
    displayName?: string | null;
    phone?: string | null;
    email?: string | null;
  },
  context: z.RefinementCtx,
) {
  if (!value.displayName && !value.phone && !value.email)
    context.addIssue({
      code: "custom",
      path: ["displayName"],
      message: "A customer profile needs a name, phone, or email.",
    });
}

export const createCustomerRequestSchema = z
  .object({
    customerId: id,
    ...customerPiiFields,
    legalHoldUntil: z.string().datetime().nullable().optional(),
    reason,
  })
  .superRefine(requireCustomerIdentity);
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

export const updateCustomerRequestSchema = z
  .object({
    revision: z.number().int().positive(),
    ...customerPiiFields,
    legalHoldUntil: z.string().datetime().nullable().optional(),
    reason,
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.phone !== undefined ||
      value.email !== undefined ||
      value.notes !== undefined ||
      value.preferredContactChannel !== undefined ||
      value.legalHoldUntil !== undefined,
    { message: "At least one customer field must be supplied." },
  );
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export const customerSearchQuerySchema = z
  .object({
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().email().max(254).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => value.phone || value.email, {
    message: "Exact phone or email search is required.",
  });
export type CustomerSearchQuery = z.infer<typeof customerSearchQuerySchema>;

export const customerResponseSchema = z.object({
  id,
  organizationId: id,
  status: customerProfileStatusSchema,
  revision: z.number().int().positive(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  notes: z.string().nullable(),
  preferredContactChannel: customerContactChannelSchema.nullable(),
  legalHoldUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  anonymizedAt: z.string().datetime().nullable(),
});
export type CustomerResponse = z.infer<typeof customerResponseSchema>;

export const recordCustomerConsentRequestSchema = z.object({
  eventId: id,
  purpose: customerConsentPurposeSchema,
  channel: customerContactChannelSchema,
  status: customerConsentStatusSchema,
  source: z.string().trim().min(1).max(80),
  wordingVersion: z.string().trim().min(1).max(80),
  occurredAt: z.string().datetime(),
  reason,
});
export type RecordCustomerConsentRequest = z.infer<
  typeof recordCustomerConsentRequestSchema
>;

export const createPrivacyRequestSchema = z.object({
  requestId: id,
  requestType: privacyRequestTypeSchema,
  dueAt: z.string().datetime().nullable().optional(),
  reason,
});
export type CreatePrivacyRequest = z.infer<typeof createPrivacyRequestSchema>;

export const transitionPrivacyRequestSchema = z.object({
  revision: z.number().int().positive(),
  status: privacyRequestStatusSchema,
  reason,
});
export type TransitionPrivacyRequest = z.infer<
  typeof transitionPrivacyRequestSchema
>;

export const privacyRequestListQuerySchema = z.object({
  status: privacyRequestStatusSchema.optional(),
  requestType: privacyRequestTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PrivacyRequestListQuery = z.infer<
  typeof privacyRequestListQuerySchema
>;

export const createRetentionPolicyRequestSchema = z.object({
  policyId: id,
  category: retentionCategorySchema,
  version: z.number().int().positive(),
  durationDays: z.number().int().positive().max(36_500),
  reason,
});
export type CreateRetentionPolicyRequest = z.infer<
  typeof createRetentionPolicyRequestSchema
>;

export const activateRetentionPolicyRequestSchema = z.object({
  revision: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  approvalReference: z.string().trim().min(1).max(160),
  reason,
});
export type ActivateRetentionPolicyRequest = z.infer<
  typeof activateRetentionPolicyRequestSchema
>;

export const retentionPreviewRequestSchema = z.object({
  policyId: id,
  asOf: z.string().datetime(),
  reason,
});
export type RetentionPreviewRequest = z.infer<
  typeof retentionPreviewRequestSchema
>;

export const customerDataAccessReasonSchema = reason;

const timestamp = z.string().datetime();

export const customerCreateResponseSchema = z.object({
  id,
  organizationId: id,
  status: customerProfileStatusSchema,
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  duplicateWarning: z.boolean(),
});
export type CustomerCreateResponse = z.infer<
  typeof customerCreateResponseSchema
>;

export const customerSearchResponseSchema = z.object({
  items: z.array(customerResponseSchema),
});

export const customerConsentResponseSchema = z.object({
  id,
  organizationId: id,
  customerId: id,
  purpose: customerConsentPurposeSchema,
  channel: customerContactChannelSchema,
  status: customerConsentStatusSchema,
  source: z.string().min(1).max(80),
  wordingVersion: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
  occurredAt: timestamp,
  recordedAt: timestamp,
  actorDisplayName: z.string().min(1).max(120),
});
export const customerConsentListResponseSchema = z.array(
  customerConsentResponseSchema,
);
export type CustomerConsentResponse = z.infer<
  typeof customerConsentResponseSchema
>;

export const privacyRequestEventResponseSchema = z.object({
  id,
  requestId: id,
  fromStatus: privacyRequestStatusSchema.nullable(),
  toStatus: privacyRequestStatusSchema,
  reason: z.string().min(1).max(500),
  occurredAt: timestamp,
  actorDisplayName: z.string().min(1).max(120),
});

export const privacyRequestResponseSchema = z.object({
  id,
  organizationId: id,
  customerId: id,
  requestType: privacyRequestTypeSchema,
  status: privacyRequestStatusSchema,
  revision: z.number().int().positive(),
  dueAt: timestamp.nullable(),
  identityVerifiedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  reason: z.string().min(1).max(500),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByDisplayName: z.string().min(1).max(120),
  identityVerifiedByDisplayName: z.string().min(1).max(120).nullable(),
  completedByDisplayName: z.string().min(1).max(120).nullable(),
  events: z.array(privacyRequestEventResponseSchema),
});
export const privacyRequestListResponseSchema = z.array(
  privacyRequestResponseSchema,
);
export type PrivacyRequestResponse = z.infer<
  typeof privacyRequestResponseSchema
>;

export const retentionPolicyResponseSchema = z.object({
  id,
  organizationId: id,
  category: retentionCategorySchema,
  version: z.number().int().positive(),
  durationDays: z.number().int().positive(),
  status: retentionPolicyStatusSchema,
  revision: z.number().int().positive(),
  effectiveFrom: timestamp.nullable(),
  approvalReference: z.string().min(1).max(160).nullable(),
  createdAt: timestamp,
  activatedAt: timestamp.nullable(),
  createdByDisplayName: z.string().min(1).max(120),
  activatedByDisplayName: z.string().min(1).max(120).nullable(),
});
export const retentionPolicyListResponseSchema = z.array(
  retentionPolicyResponseSchema,
);
export type RetentionPolicyResponse = z.infer<
  typeof retentionPolicyResponseSchema
>;

export const retentionPreviewResponseSchema = z.object({
  generatedAt: timestamp,
  policyId: id,
  category: retentionCategorySchema,
  asOf: timestamp,
  cutoff: timestamp,
  candidateCount: z.number().int().nonnegative(),
  issues: z.array(z.string().min(1)),
  executionEnabled: z.literal(false),
});
export type RetentionPreviewResponse = z.infer<
  typeof retentionPreviewResponseSchema
>;

export const customerExportResponseSchema = z.object({
  generatedAt: timestamp,
  customer: customerResponseSchema,
  consents: z.array(customerConsentResponseSchema),
  privacyRequests: z.array(privacyRequestResponseSchema),
});
export type CustomerExportResponse = z.infer<
  typeof customerExportResponseSchema
>;
