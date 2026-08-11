-- Append-only backup and restore evidence. This migration does not enable a
-- storage provider or define Base Cafe's production retention/RPO/RTO policy.
CREATE TYPE "OperationalEvidenceKind" AS ENUM ('BACKUP', 'RESTORE_DRILL');
CREATE TYPE "OperationalEvidenceOutcome" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "OperationalEvidenceSource" AS ENUM (
  'LOCAL_ENCRYPTED_ARCHIVE',
  'MANAGED_PROVIDER',
  'MANUAL_EVIDENCE'
);

CREATE TABLE "operational_evidence" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "kind" "OperationalEvidenceKind" NOT NULL,
  "outcome" "OperationalEvidenceOutcome" NOT NULL,
  "source" "OperationalEvidenceSource" NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "encrypted" BOOLEAN NOT NULL,
  "checksum_sha256" CHAR(64),
  "artifact_reference" VARCHAR(240),
  "retention_until" TIMESTAMPTZ(3),
  "application_version" VARCHAR(80) NOT NULL,
  "schema_version" VARCHAR(120) NOT NULL,
  "checks" JSONB NOT NULL,
  "failure_code" VARCHAR(80),
  "safe_failure_message" VARCHAR(500),
  "recorded_by_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "operational_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_evidence_time_check" CHECK (
    "completed_at" >= "started_at"
  ),
  CONSTRAINT "operational_evidence_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 500
  ),
  CONSTRAINT "operational_evidence_failure_check" CHECK (
    (
      "outcome" = 'FAILED'
      AND "failure_code" IS NOT NULL
      AND "safe_failure_message" IS NOT NULL
      AND char_length(btrim("safe_failure_message")) BETWEEN 1 AND 500
    )
    OR
    (
      "outcome" = 'SUCCEEDED'
      AND "failure_code" IS NULL
      AND "safe_failure_message" IS NULL
    )
  ),
  CONSTRAINT "operational_evidence_checksum_check" CHECK (
    "checksum_sha256" IS NULL
    OR "checksum_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "operational_evidence_reference_check" CHECK (
    "artifact_reference" IS NULL
    OR (
      "artifact_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$'
      AND position('..' IN "artifact_reference") = 0
      AND "artifact_reference" !~ '^[A-Za-z]:/'
    )
  ),
  CONSTRAINT "operational_evidence_backup_success_check" CHECK (
    "outcome" <> 'SUCCEEDED'
    OR "kind" <> 'BACKUP'
    OR (
      "encrypted" = TRUE
      AND "checksum_sha256" IS NOT NULL
      AND "retention_until" IS NOT NULL
    )
  ),
  CONSTRAINT "operational_evidence_restore_success_check" CHECK (
    "outcome" <> 'SUCCEEDED'
    OR "kind" <> 'RESTORE_DRILL'
    OR (
      "checks" ->> 'archiveReadable' = 'true'
      AND "checks" ->> 'databaseRestored' = 'true'
      AND "checks" ->> 'integrityQueriesPassed' = 'true'
    )
  )
);

ALTER TABLE "operational_evidence"
  ADD CONSTRAINT "operational_evidence_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operational_evidence"
  ADD CONSTRAINT "operational_evidence_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "operational_evidence_organization_id_kind_completed_at_idx"
  ON "operational_evidence"("organization_id", "kind", "completed_at");
CREATE INDEX "operational_evidence_organization_id_outcome_recorded_at_idx"
  ON "operational_evidence"("organization_id", "outcome", "recorded_at");
CREATE INDEX "operational_evidence_recorded_by_id_recorded_at_idx"
  ON "operational_evidence"("recorded_by_id", "recorded_at");

CREATE OR REPLACE FUNCTION "operational_evidence_append_only_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'operational recovery evidence is append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "operational_evidence_reject_update"
BEFORE UPDATE ON "operational_evidence"
FOR EACH ROW EXECUTE FUNCTION "operational_evidence_append_only_guard"();

CREATE TRIGGER "operational_evidence_reject_delete"
BEFORE DELETE ON "operational_evidence"
FOR EACH ROW EXECUTE FUNCTION "operational_evidence_append_only_guard"();

INSERT INTO "permissions" ("key", "description") VALUES
  ('operations.read', 'View organization operational diagnostics and recovery evidence'),
  ('operations.manage', 'Record reviewed backup and restore evidence')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
