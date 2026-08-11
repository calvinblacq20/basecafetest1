-- Append-only manager resolution for terminal offline command outcomes.
CREATE TABLE "sync_command_resolutions" (
    "id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "successor_command_id" UUID,
    "resolved_by_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_command_resolutions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_command_resolutions_command_id_key" UNIQUE ("command_id"),
    CONSTRAINT "sync_command_resolutions_action_check" CHECK (
      "action" IN ('ACKNOWLEDGED_NO_ACTION', 'SUPERSEDED_BY_COMMAND')
    ),
    CONSTRAINT "sync_command_resolutions_successor_check" CHECK (
      ("action" = 'ACKNOWLEDGED_NO_ACTION' AND "successor_command_id" IS NULL)
      OR
      ("action" = 'SUPERSEDED_BY_COMMAND' AND "successor_command_id" IS NOT NULL)
    ),
    CONSTRAINT "sync_command_resolutions_reason_check" CHECK (
      char_length(btrim("reason")) BETWEEN 1 AND 500
    ),
    CONSTRAINT "sync_command_resolutions_no_self_successor_check" CHECK (
      "successor_command_id" IS NULL OR "successor_command_id" <> "command_id"
    )
);

CREATE INDEX "sync_command_resolutions_resolved_by_id_resolved_at_idx"
  ON "sync_command_resolutions"("resolved_by_id", "resolved_at");
CREATE INDEX "sync_command_resolutions_successor_command_id_idx"
  ON "sync_command_resolutions"("successor_command_id");

ALTER TABLE "sync_command_resolutions"
  ADD CONSTRAINT "sync_command_resolutions_command_id_fkey"
  FOREIGN KEY ("command_id") REFERENCES "sync_command_receipts"("command_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_command_resolutions"
  ADD CONSTRAINT "sync_command_resolutions_successor_command_id_fkey"
  FOREIGN KEY ("successor_command_id") REFERENCES "sync_command_receipts"("command_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_command_resolutions"
  ADD CONSTRAINT "sync_command_resolutions_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "sync_command_resolution_scope_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_record "sync_command_receipts"%ROWTYPE;
  successor_record "sync_command_receipts"%ROWTYPE;
BEGIN
  SELECT * INTO source_record
  FROM "sync_command_receipts"
  WHERE "command_id" = NEW."command_id";

  IF source_record."status" NOT IN ('CONFLICT', 'REJECTED') THEN
    RAISE EXCEPTION 'only terminal sync commands may be resolved' USING ERRCODE = '23514';
  END IF;

  IF NEW."action" = 'SUPERSEDED_BY_COMMAND' THEN
    SELECT * INTO successor_record
    FROM "sync_command_receipts"
    WHERE "command_id" = NEW."successor_command_id";

    IF successor_record."status" <> 'APPLIED'
       OR successor_record."organization_id" <> source_record."organization_id"
       OR successor_record."branch_id" <> source_record."branch_id"
       OR successor_record."device_id" <> source_record."device_id"
       OR successor_record."aggregate_id" <> source_record."aggregate_id"
       OR successor_record."local_sequence" <= source_record."local_sequence" THEN
      RAISE EXCEPTION 'sync successor must be a later applied command in the same device aggregate' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sync_command_resolutions_scope_guard"
BEFORE INSERT ON "sync_command_resolutions"
FOR EACH ROW EXECUTE FUNCTION "sync_command_resolution_scope_guard"();

CREATE OR REPLACE FUNCTION "sync_command_resolution_append_only_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sync command resolutions are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "sync_command_resolutions_reject_update"
BEFORE UPDATE ON "sync_command_resolutions"
FOR EACH ROW EXECUTE FUNCTION "sync_command_resolution_append_only_guard"();
CREATE TRIGGER "sync_command_resolutions_reject_delete"
BEFORE DELETE ON "sync_command_resolutions"
FOR EACH ROW EXECUTE FUNCTION "sync_command_resolution_append_only_guard"();

INSERT INTO "permissions" ("key", "description") VALUES
  ('sync.recovery.read', 'View branch offline synchronization exceptions'),
  ('sync.recovery.manage', 'Resolve reviewed terminal synchronization commands')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
