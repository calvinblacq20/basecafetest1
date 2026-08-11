-- Security operations foundation. Alert delivery and thresholds remain internal
-- and conservative until incident contacts and escalation policy are approved.
CREATE TYPE "SecurityAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "SecurityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "SecurityAlertEventType" AS ENUM ('DETECTED', 'OBSERVED', 'REOPENED', 'ACKNOWLEDGED', 'RESOLVED');

ALTER TABLE "sessions"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revoked_by_id" UUID,
  ADD COLUMN "revoked_at" TIMESTAMPTZ(3),
  ADD COLUMN "revocation_reason" VARCHAR(500);

UPDATE "sessions"
SET "revoked_at" = COALESCE("last_used_at", "created_at"),
    "revocation_reason" = 'Historical revocation recorded before security operations metadata.'
WHERE "status" = 'REVOKED';

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_revocation_lifecycle_check" CHECK (
    ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND char_length(btrim("revocation_reason")) BETWEEN 1 AND 500)
    OR
    ("status" <> 'REVOKED' AND "revoked_by_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
  ),
  ADD CONSTRAINT "sessions_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "sessions_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "sessions_device_id_status_expires_at_idx" ON "sessions"("device_id", "status", "expires_at");
CREATE INDEX "sessions_revoked_by_id_revoked_at_idx" ON "sessions"("revoked_by_id", "revoked_at");

CREATE TABLE "security_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "branch_id" UUID,
  "fingerprint_hash" CHAR(64) NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "severity" "SecurityAlertSeverity" NOT NULL,
  "status" "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
  "source" VARCHAR(60) NOT NULL,
  "summary" VARCHAR(240) NOT NULL,
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "acknowledged_by_id" UUID,
  "acknowledged_at" TIMESTAMPTZ(3),
  "acknowledgement_reason" VARCHAR(500),
  "resolved_by_id" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "resolution_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alerts_organization_id_fingerprint_hash_key" UNIQUE ("organization_id", "fingerprint_hash"),
  CONSTRAINT "security_alerts_fingerprint_check" CHECK ("fingerprint_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "security_alerts_values_check" CHECK (
    "occurrence_count" > 0 AND "revision" > 0
    AND char_length(btrim("code")) BETWEEN 1 AND 80
    AND char_length(btrim("source")) BETWEEN 1 AND 60
    AND char_length(btrim("summary")) BETWEEN 1 AND 240
    AND "last_seen_at" >= "first_seen_at"
  ),
  CONSTRAINT "security_alerts_lifecycle_check" CHECK (
    ("status" = 'OPEN' AND "acknowledged_by_id" IS NULL AND "acknowledged_at" IS NULL AND "acknowledgement_reason" IS NULL AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL AND "resolution_reason" IS NULL)
    OR
    ("status" = 'ACKNOWLEDGED' AND "acknowledged_by_id" IS NOT NULL AND "acknowledged_at" IS NOT NULL AND char_length(btrim("acknowledgement_reason")) BETWEEN 1 AND 500 AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL AND "resolution_reason" IS NULL)
    OR
    ("status" = 'RESOLVED' AND "acknowledged_by_id" IS NOT NULL AND "acknowledged_at" IS NOT NULL AND char_length(btrim("acknowledgement_reason")) BETWEEN 1 AND 500 AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND char_length(btrim("resolution_reason")) BETWEEN 1 AND 500)
  )
);

CREATE TABLE "security_alert_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "alert_id" UUID NOT NULL,
  "type" "SecurityAlertEventType" NOT NULL,
  "actor_id" UUID,
  "reason" VARCHAR(500),
  "data" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_alert_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alert_events_reason_check" CHECK ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500)
);

ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alert_events" ADD CONSTRAINT "security_alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "security_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_alert_events" ADD CONSTRAINT "security_alert_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "security_alerts_organization_id_status_severity_last_seen_at_idx" ON "security_alerts"("organization_id", "status", "severity", "last_seen_at");
CREATE INDEX "security_alerts_branch_id_status_last_seen_at_idx" ON "security_alerts"("branch_id", "status", "last_seen_at");
CREATE INDEX "security_alert_events_alert_id_occurred_at_idx" ON "security_alert_events"("alert_id", "occurred_at");
CREATE INDEX "security_alert_events_actor_id_occurred_at_idx" ON "security_alert_events"("actor_id", "occurred_at");

CREATE OR REPLACE FUNCTION "session_security_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."user_id" <> NEW."user_id" OR OLD."device_id" <> NEW."device_id" OR OLD."token_hash" <> NEW."token_hash" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'session identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'session revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'ACTIVE' OR NEW."status" NOT IN ('ACTIVE', 'REVOKED', 'EXPIRED') THEN
    RAISE EXCEPTION 'invalid session lifecycle transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."revoked_by_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "users" actor
    JOIN "users" subject ON subject."id" = NEW."user_id"
    WHERE actor."id" = NEW."revoked_by_id" AND actor."organization_id" = subject."organization_id"
  ) THEN
    RAISE EXCEPTION 'session revoker organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sessions_security_lifecycle_guard" BEFORE UPDATE ON "sessions" FOR EACH ROW EXECUTE FUNCTION "session_security_lifecycle_guard"();

CREATE OR REPLACE FUNCTION "security_alert_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."branch_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."organization_id" = NEW."organization_id") THEN
    RAISE EXCEPTION 'security alert branch organization mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."acknowledged_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."acknowledged_by_id" AND u."organization_id" = NEW."organization_id") THEN
    RAISE EXCEPTION 'security alert acknowledger organization mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."resolved_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."resolved_by_id" AND u."organization_id" = NEW."organization_id") THEN
    RAISE EXCEPTION 'security alert resolver organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "security_alerts_tenant_guard" BEFORE INSERT OR UPDATE ON "security_alerts" FOR EACH ROW EXECUTE FUNCTION "security_alert_tenant_guard"();

CREATE OR REPLACE FUNCTION "security_alert_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."organization_id" <> NEW."organization_id" OR OLD."branch_id" IS DISTINCT FROM NEW."branch_id" OR OLD."fingerprint_hash" <> NEW."fingerprint_hash" OR OLD."code" <> NEW."code" OR OLD."source" <> NEW."source" OR OLD."first_seen_at" <> NEW."first_seen_at" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'security alert identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 OR NEW."occurrence_count" < OLD."occurrence_count" THEN
    RAISE EXCEPTION 'security alert revision or occurrence count invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'OPEN' AND NEW."status" NOT IN ('OPEN', 'ACKNOWLEDGED') THEN
    RAISE EXCEPTION 'invalid security alert transition' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'ACKNOWLEDGED' AND NEW."status" NOT IN ('ACKNOWLEDGED', 'RESOLVED') THEN
    RAISE EXCEPTION 'invalid security alert transition' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'RESOLVED' AND NEW."status" NOT IN ('RESOLVED', 'OPEN') THEN
    RAISE EXCEPTION 'invalid security alert transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "security_alerts_lifecycle_guard" BEFORE UPDATE ON "security_alerts" FOR EACH ROW EXECUTE FUNCTION "security_alert_lifecycle_guard"();

CREATE OR REPLACE FUNCTION "security_alert_event_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_organization UUID;
BEGIN
  SELECT "organization_id" INTO source_organization FROM "security_alerts" WHERE "id" = NEW."alert_id";
  IF source_organization IS NULL OR (NEW."actor_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."actor_id" AND u."organization_id" = source_organization)) THEN
    RAISE EXCEPTION 'security alert event organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "security_alert_events_tenant_guard" BEFORE INSERT ON "security_alert_events" FOR EACH ROW EXECUTE FUNCTION "security_alert_event_tenant_guard"();

CREATE OR REPLACE FUNCTION "security_alert_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security alert events are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "security_alert_events_reject_update" BEFORE UPDATE OR DELETE ON "security_alert_events" FOR EACH ROW EXECUTE FUNCTION "security_alert_append_only_guard"();
CREATE TRIGGER "security_alerts_reject_delete" BEFORE DELETE ON "security_alerts" FOR EACH ROW EXECUTE FUNCTION "security_alert_append_only_guard"();

-- Crypto rewrapping may change only envelope metadata. Business/customer facts,
-- blind indexes and ownership remain immutable on order contact snapshots.
CREATE OR REPLACE FUNCTION "order_customer_contact_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."order_id" <> NEW."order_id" OR OLD."organization_id" <> NEW."organization_id" OR OLD."branch_id" <> NEW."branch_id" OR OLD."customer_id" IS DISTINCT FROM NEW."customer_id" OR OLD."created_at" <> NEW."created_at" OR OLD."phone_blind_index" IS DISTINCT FROM NEW."phone_blind_index" THEN
    RAISE EXCEPTION 'order customer contact ownership and blind index are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."anonymized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'anonymized order customer contact cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO "permissions" ("key", "description") VALUES
  ('audit.export', 'Export bounded redacted audit history'),
  ('security.alerts.read', 'View organization security alerts'),
  ('security.alerts.manage', 'Evaluate, acknowledge and resolve security alerts'),
  ('security.sessions.read', 'View safe organization session metadata'),
  ('security.sessions.manage', 'Revoke organization sessions with a reason'),
  ('privacy.keys.read', 'View safe customer encryption key posture'),
  ('privacy.keys.manage', 'Rewrap bounded customer encryption envelopes')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
