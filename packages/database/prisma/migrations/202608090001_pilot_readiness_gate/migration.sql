CREATE TABLE "pilot_readiness_evidence" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "safe_reference" VARCHAR(240),
  "recorded_by_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pilot_readiness_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pilot_readiness_evidence_value_check" CHECK (
    "code" IN (
      'OWNER_SCOPE_APPROVED', 'ACCOUNTANT_TAX_APPROVED',
      'PAYMENT_PROCESS_APPROVED', 'FISCAL_PROCESS_APPROVED',
      'PRIVACY_APPROVED', 'HARDWARE_SITE_TESTED', 'PRINTER_FLOW_TESTED',
      'OFFLINE_DRILL_PASSED', 'RECONCILIATION_PASSED',
      'TRAINING_COMPLETED', 'ROLLBACK_APPROVED',
      'INCIDENT_CONTACTS_APPROVED', 'OWNER_PILOT_SIGNOFF'
    )
    AND "outcome" IN ('CONFIRMED', 'FAILED', 'REVOKED')
    AND char_length(btrim("reason")) BETWEEN 1 AND 500
    AND ("safe_reference" IS NULL OR char_length(btrim("safe_reference")) BETWEEN 1 AND 240)
  ),
  CONSTRAINT "pilot_readiness_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pilot_readiness_evidence_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "pilot_readiness_reviews" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "blocked_count" INTEGER NOT NULL,
  "unconfirmed_count" INTEGER NOT NULL,
  "passed_count" INTEGER NOT NULL,
  "checks" JSONB NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pilot_readiness_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pilot_readiness_reviews_value_check" CHECK (
    "status" IN ('READY', 'BLOCKED', 'UNCONFIRMED')
    AND "blocked_count" >= 0 AND "unconfirmed_count" >= 0 AND "passed_count" >= 0
    AND "blocked_count" + "unconfirmed_count" + "passed_count" > 0
    AND char_length(btrim("reason")) BETWEEN 1 AND 500
  ),
  CONSTRAINT "pilot_readiness_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pilot_readiness_reviews_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "pilot_readiness_evidence_organization_id_code_observed_at_id_idx" ON "pilot_readiness_evidence"("organization_id", "code", "observed_at", "id");
CREATE INDEX "pilot_readiness_evidence_recorded_by_id_recorded_at_idx" ON "pilot_readiness_evidence"("recorded_by_id", "recorded_at");
CREATE INDEX "pilot_readiness_reviews_organization_id_recorded_at_id_idx" ON "pilot_readiness_reviews"("organization_id", "recorded_at", "id");
CREATE INDEX "pilot_readiness_reviews_organization_id_status_recorded_at_idx" ON "pilot_readiness_reviews"("organization_id", "status", "recorded_at");
CREATE INDEX "pilot_readiness_reviews_recorded_by_id_recorded_at_idx" ON "pilot_readiness_reviews"("recorded_by_id", "recorded_at");

CREATE OR REPLACE FUNCTION "pilot_readiness_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."id" = NEW."recorded_by_id" AND u."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'pilot readiness recorder organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "pilot_readiness_evidence_tenant_guard" BEFORE INSERT ON "pilot_readiness_evidence" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_tenant_guard"();
CREATE TRIGGER "pilot_readiness_reviews_tenant_guard" BEFORE INSERT ON "pilot_readiness_reviews" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_tenant_guard"();

CREATE OR REPLACE FUNCTION "pilot_readiness_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pilot readiness history is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "pilot_readiness_evidence_reject_update" BEFORE UPDATE ON "pilot_readiness_evidence" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_append_only_guard"();
CREATE TRIGGER "pilot_readiness_evidence_reject_delete" BEFORE DELETE ON "pilot_readiness_evidence" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_append_only_guard"();
CREATE TRIGGER "pilot_readiness_reviews_reject_update" BEFORE UPDATE ON "pilot_readiness_reviews" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_append_only_guard"();
CREATE TRIGGER "pilot_readiness_reviews_reject_delete" BEFORE DELETE ON "pilot_readiness_reviews" FOR EACH ROW EXECUTE FUNCTION "pilot_readiness_append_only_guard"();

INSERT INTO "permissions" ("key", "description") VALUES
  ('release.read', 'View pilot and production readiness evidence'),
  ('release.manage', 'Record readiness evidence and review snapshots')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
