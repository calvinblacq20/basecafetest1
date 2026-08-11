import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const auditIntegrityBatchListQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditIntegrityBatchListQuery = z.infer<
  typeof auditIntegrityBatchListQuerySchema
>;

export const createAuditIntegrityBatchRequestSchema = z.object({
  batchId: id,
  through: z.string().datetime(),
  maxEvents: z.number().int().min(1).max(5_000).default(5_000),
  reason,
});
export type CreateAuditIntegrityBatchRequest = z.infer<
  typeof createAuditIntegrityBatchRequestSchema
>;

export const verifyAuditIntegrityRequestSchema = z.object({
  fromSequence: z.number().int().positive().default(1),
  maxBatches: z.number().int().min(1).max(100).default(100),
  reason,
});
export type VerifyAuditIntegrityRequest = z.infer<
  typeof verifyAuditIntegrityRequestSchema
>;
