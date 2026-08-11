import { z } from "zod";

const identifierSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const safeReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  .refine(
    (value) => !value.includes("..") && !/^[A-Za-z]:\//.test(value),
    "Artifact references must be safe relative identifiers, not paths.",
  );
const safeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z0-9][A-Z0-9_:-]*$/);

export const operationalEvidenceKindSchema = z.enum([
  "BACKUP",
  "RESTORE_DRILL",
]);
export const operationalEvidenceOutcomeSchema = z.enum(["SUCCEEDED", "FAILED"]);
export const operationalEvidenceSourceSchema = z.enum([
  "LOCAL_ENCRYPTED_ARCHIVE",
  "MANAGED_PROVIDER",
  "MANUAL_EVIDENCE",
]);

const checkValueSchema = z.union([
  z.boolean(),
  z.number().int().safe(),
  z.string().trim().max(240),
]);

export const recordOperationalEvidenceRequestSchema = z
  .object({
    evidenceId: identifierSchema,
    kind: operationalEvidenceKindSchema,
    outcome: operationalEvidenceOutcomeSchema,
    source: operationalEvidenceSourceSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    encrypted: z.boolean(),
    checksumSha256: sha256Schema.nullable().optional(),
    artifactReference: safeReferenceSchema.nullable().optional(),
    retentionUntil: z.string().datetime().nullable().optional(),
    applicationVersion: z.string().trim().min(1).max(80),
    schemaVersion: z.string().trim().min(1).max(120),
    checks: z.record(z.string().min(1).max(80), checkValueSchema).default({}),
    failureCode: safeCodeSchema.nullable().optional(),
    safeFailureMessage: z.string().trim().min(1).max(500).nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    const startedAt = Date.parse(value.startedAt);
    const completedAt = Date.parse(value.completedAt);
    if (completedAt < startedAt) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion must not precede the start time.",
      });
    }

    if (value.outcome === "FAILED") {
      if (!value.failureCode || !value.safeFailureMessage) {
        context.addIssue({
          code: "custom",
          path: ["failureCode"],
          message: "Failed evidence requires a safe failure code and message.",
        });
      }
      return;
    }

    if (value.failureCode || value.safeFailureMessage) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Successful evidence cannot contain failure details.",
      });
    }

    if (value.kind === "BACKUP") {
      if (!value.encrypted || !value.checksumSha256 || !value.retentionUntil) {
        context.addIssue({
          code: "custom",
          path: ["encrypted"],
          message:
            "Successful backup evidence requires encryption, a checksum, and retention expiry.",
        });
      }
    }

    if (
      value.kind === "RESTORE_DRILL" &&
      (value.checks.archiveReadable !== true ||
        value.checks.databaseRestored !== true ||
        value.checks.integrityQueriesPassed !== true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message:
          "A successful restore drill requires archive, database restore, and integrity checks.",
      });
    }
  });

export type RecordOperationalEvidenceRequest = z.infer<
  typeof recordOperationalEvidenceRequestSchema
>;

export const operationalEvidenceResponseSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  kind: operationalEvidenceKindSchema,
  outcome: operationalEvidenceOutcomeSchema,
  source: operationalEvidenceSourceSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  encrypted: z.boolean(),
  checksumSha256: sha256Schema.nullable(),
  artifactReference: safeReferenceSchema.nullable(),
  retentionUntil: z.string().datetime().nullable(),
  applicationVersion: z.string(),
  schemaVersion: z.string(),
  checks: z.record(z.string(), checkValueSchema),
  failureCode: safeCodeSchema.nullable(),
  safeFailureMessage: z.string().nullable(),
  recordedById: identifierSchema,
  reason: z.string(),
  recordedAt: z.string().datetime(),
});

export type OperationalEvidenceResponse = z.infer<
  typeof operationalEvidenceResponseSchema
>;

export const operationalEvidenceListQuerySchema = z.object({
  kind: operationalEvidenceKindSchema.optional(),
  outcome: operationalEvidenceOutcomeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type OperationalEvidenceListQuery = z.infer<
  typeof operationalEvidenceListQuerySchema
>;

const latestEvidenceSummarySchema = z
  .object({
    id: identifierSchema,
    outcome: operationalEvidenceOutcomeSchema,
    completedAt: z.string().datetime(),
    recordedAt: z.string().datetime(),
    failureCode: safeCodeSchema.nullable(),
  })
  .nullable();

export const operationsDiagnosticsResponseSchema = z.object({
  service: z.literal("base-cafe-api"),
  version: z.string(),
  generatedAt: z.string().datetime(),
  database: z.enum(["up", "down"]),
  outbox: z.object({
    unpublishedCount: z.number().int().nonnegative(),
    oldestUnpublishedAt: z.string().datetime().nullable(),
    maximumAttempts: z.number().int().nonnegative(),
  }),
  synchronization: z.object({
    unresolvedTerminalCommandCount: z.number().int().nonnegative(),
  }),
  recovery: z.object({
    latestBackup: latestEvidenceSummarySchema,
    latestRestoreDrill: latestEvidenceSummarySchema,
  }),
  alerts: z.array(
    z.object({
      code: safeCodeSchema,
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
      message: z.string().max(240),
    }),
  ),
});

export type OperationsDiagnosticsResponse = z.infer<
  typeof operationsDiagnosticsResponseSchema
>;

export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("base-cafe-api"),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = livenessResponseSchema.extend({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["up", "down"]),
  outbox: z.object({
    unpublishedCount: z.number().int().nonnegative(),
    oldestUnpublishedAt: z.string().datetime().nullable(),
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
