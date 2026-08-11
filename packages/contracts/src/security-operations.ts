import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);
const keyVersion = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const auditOutcomeFilterSchema = z.enum([
  "SUCCESS",
  "DENIED",
  "FAILURE",
]);

export const auditReviewQuerySchema = z
  .object({
    branchId: id.optional(),
    action: z.string().trim().min(1).max(120).optional(),
    outcome: auditOutcomeFilterSchema.optional(),
    actorId: id.optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.to) < Date.parse(value.from))
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The audit range end must not precede its start.",
      });
  });
export type AuditReviewQuery = z.infer<typeof auditReviewQuerySchema>;

export const securityAlertSeveritySchema = z.enum([
  "INFO",
  "WARNING",
  "CRITICAL",
]);
export const securityAlertStatusSchema = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
]);

export const securityAlertListQuerySchema = z.object({
  branchId: id.optional(),
  severity: securityAlertSeveritySchema.optional(),
  status: securityAlertStatusSchema.optional(),
  code: z.string().trim().min(1).max(80).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SecurityAlertListQuery = z.infer<
  typeof securityAlertListQuerySchema
>;

export const evaluateSecurityMonitoringRequestSchema = z.object({
  evaluationId: id,
  asOf: z.string().datetime(),
  windowMinutes: z.number().int().min(5).max(1_440).default(60),
  reason,
});
export type EvaluateSecurityMonitoringRequest = z.infer<
  typeof evaluateSecurityMonitoringRequestSchema
>;

export const transitionSecurityAlertRequestSchema = z.object({
  revision: z.number().int().positive(),
  reason,
});
export type TransitionSecurityAlertRequest = z.infer<
  typeof transitionSecurityAlertRequestSchema
>;

export const securitySessionListQuerySchema = z.object({
  branchId: id.optional(),
  userId: id.optional(),
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SecuritySessionListQuery = z.infer<
  typeof securitySessionListQuerySchema
>;

export const revokeSecuritySessionRequestSchema = z.object({
  revision: z.number().int().positive(),
  reason,
});
export type RevokeSecuritySessionRequest = z.infer<
  typeof revokeSecuritySessionRequestSchema
>;

export const rewrapCustomerPiiRequestSchema = z.object({
  sourceKeyVersion: keyVersion,
  limit: z.number().int().min(1).max(100).default(25),
  reason,
});
export type RewrapCustomerPiiRequest = z.infer<
  typeof rewrapCustomerPiiRequestSchema
>;

export const legacyCustomerPiiPreviewRequestSchema = z.object({
  branchId: id.optional(),
  reason,
});
export type LegacyCustomerPiiPreviewRequest = z.infer<
  typeof legacyCustomerPiiPreviewRequestSchema
>;
