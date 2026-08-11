import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const pilotEvidenceCodeSchema = z.enum([
  "OWNER_SCOPE_APPROVED",
  "ACCOUNTANT_TAX_APPROVED",
  "PAYMENT_PROCESS_APPROVED",
  "FISCAL_PROCESS_APPROVED",
  "PRIVACY_APPROVED",
  "HARDWARE_SITE_TESTED",
  "PRINTER_FLOW_TESTED",
  "OFFLINE_DRILL_PASSED",
  "RECONCILIATION_PASSED",
  "TRAINING_COMPLETED",
  "ROLLBACK_APPROVED",
  "INCIDENT_CONTACTS_APPROVED",
  "OWNER_PILOT_SIGNOFF",
]);
export type PilotEvidenceCode = z.infer<typeof pilotEvidenceCodeSchema>;

export const pilotEvidenceOutcomeSchema = z.enum([
  "CONFIRMED",
  "FAILED",
  "REVOKED",
]);

export const pilotReadinessListQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PilotReadinessListQuery = z.infer<
  typeof pilotReadinessListQuerySchema
>;

export const recordPilotEvidenceRequestSchema = z.object({
  evidenceId: id,
  code: pilotEvidenceCodeSchema,
  outcome: pilotEvidenceOutcomeSchema,
  observedAt: z.string().datetime(),
  safeReference: z.string().trim().min(1).max(240).nullable().default(null),
  reason,
});
export type RecordPilotEvidenceRequest = z.infer<
  typeof recordPilotEvidenceRequestSchema
>;

export const capturePilotReadinessReviewRequestSchema = z.object({
  reviewId: id,
  reason,
});
export type CapturePilotReadinessReviewRequest = z.infer<
  typeof capturePilotReadinessReviewRequestSchema
>;
