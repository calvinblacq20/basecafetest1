-- Tamper-evident audit batches. This is an internal SHA-256 chain; external
-- signing and scheduling remain disabled until custody and operations policy exist.
CREATE TABLE "audit_integrity_batches" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "algorithm" VARCHAR(16) NOT NULL DEFAULT 'SHA256',
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "previous_hash" CHAR(64) NOT NULL,
  "batch_hash" CHAR(64) NOT NULL,
  "event_count" INTEGER NOT NULL,
  "first_event_id" UUID NOT NULL,
  "first_event_occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "last_event_id" UUID NOT NULL,
  "last_event_occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "through_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_integrity_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_integrity_batches_values_check" CHECK (
    "sequence" > 0 AND "schema_version" = 1 AND "algorithm" = 'SHA256'
    AND "previous_hash" ~ '^[a-f0-9]{64}$'
    AND "batch_hash" ~ '^[a-f0-9]{64}$'
    AND "event_count" BETWEEN 1 AND 5000
    AND ("last_event_occurred_at", "last_event_id") >= ("first_event_occurred_at", "first_event_id")
    AND "through_at" >= "last_event_occurred_at"
    AND char_length(btrim("reason")) BETWEEN 1 AND 500
  ),
  CONSTRAINT "audit_integrity_batches_organization_id_sequence_key" UNIQUE ("organization_id", "sequence"),
  CONSTRAINT "audit_integrity_batches_organization_id_batch_hash_key" UNIQUE ("organization_id", "batch_hash"),
  CONSTRAINT "audit_integrity_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_integrity_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "audit_integrity_batches_organization_id_created_at_idx" ON "audit_integrity_batches"("organization_id", "created_at");
CREATE INDEX "audit_integrity_batches_created_by_id_created_at_idx" ON "audit_integrity_batches"("created_by_id", "created_at");

CREATE OR REPLACE FUNCTION "audit_integrity_batch_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_batch "audit_integrity_batches"%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."id" = NEW."created_by_id" AND u."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'audit integrity batch creator organization mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW."sequence" = 1 THEN
    IF NEW."previous_hash" <> repeat('0', 64) OR EXISTS (
      SELECT 1 FROM "audit_integrity_batches" b WHERE b."organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION 'invalid audit integrity genesis batch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO previous_batch FROM "audit_integrity_batches" b
    WHERE b."organization_id" = NEW."organization_id" AND b."sequence" = NEW."sequence" - 1;
    IF previous_batch."id" IS NULL OR NEW."previous_hash" <> previous_batch."batch_hash" THEN
      RAISE EXCEPTION 'audit integrity chain predecessor mismatch' USING ERRCODE = '23514';
    END IF;
    IF (NEW."first_event_occurred_at", NEW."first_event_id") <= (previous_batch."last_event_occurred_at", previous_batch."last_event_id") THEN
      RAISE EXCEPTION 'audit integrity event ranges overlap' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "audit_integrity_batches_insert_guard" BEFORE INSERT ON "audit_integrity_batches" FOR EACH ROW EXECUTE FUNCTION "audit_integrity_batch_insert_guard"();

CREATE OR REPLACE FUNCTION "audit_integrity_batch_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit integrity batches are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "audit_integrity_batches_reject_update" BEFORE UPDATE ON "audit_integrity_batches" FOR EACH ROW EXECUTE FUNCTION "audit_integrity_batch_append_only_guard"();
CREATE TRIGGER "audit_integrity_batches_reject_delete" BEFORE DELETE ON "audit_integrity_batches" FOR EACH ROW EXECUTE FUNCTION "audit_integrity_batch_append_only_guard"();

INSERT INTO "permissions" ("key", "description") VALUES
  ('audit.integrity.read', 'View and verify tamper-evident audit batches'),
  ('audit.integrity.manage', 'Create tamper-evident audit batches')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
