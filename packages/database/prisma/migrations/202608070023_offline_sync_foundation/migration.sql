CREATE TABLE "sync_command_receipts" (
    "command_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "command_type" VARCHAR(64) NOT NULL,
    "local_sequence" BIGINT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "error_code" VARCHAR(120),
    "result_body" JSONB NOT NULL,
    "device_created_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_command_receipts_pkey" PRIMARY KEY ("command_id"),
    CONSTRAINT "sync_command_local_sequence_check" CHECK ("local_sequence" > 0),
    CONSTRAINT "sync_command_schema_version_check" CHECK ("schema_version" = 1),
    CONSTRAINT "sync_command_payload_hash_check" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "sync_command_type_check" CHECK ("command_type" IN ('ORDER_CREATE', 'ORDER_LINE_ADD', 'ORDER_HOLD', 'ORDER_RESUME', 'ORDER_CANCEL', 'ORDER_SEND', 'CASH_PAYMENT_CREATE', 'INVENTORY_CONSUMPTION_POST')),
    CONSTRAINT "sync_command_status_check" CHECK ("status" IN ('APPLIED', 'CONFLICT', 'REJECTED')),
    CONSTRAINT "sync_command_completion_check" CHECK ("completed_at" >= "received_at")
);

CREATE UNIQUE INDEX "sync_command_receipts_device_id_local_sequence_key"
ON "sync_command_receipts"("device_id", "local_sequence");

CREATE INDEX "sync_command_receipts_organization_id_branch_id_received_at_idx"
ON "sync_command_receipts"("organization_id", "branch_id", "received_at");

CREATE INDEX "sync_command_receipts_branch_id_aggregate_id_local_sequence_idx"
ON "sync_command_receipts"("branch_id", "aggregate_id", "local_sequence");

CREATE INDEX "sync_command_receipts_actor_id_received_at_idx"
ON "sync_command_receipts"("actor_id", "received_at");

ALTER TABLE "sync_command_receipts" ADD CONSTRAINT "sync_command_receipts_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_command_receipts" ADD CONSTRAINT "sync_command_receipts_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_command_receipts" ADD CONSTRAINT "sync_command_receipts_device_id_fkey"
FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_command_receipts" ADD CONSTRAINT "sync_command_receipts_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "sync_command_scope_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "branches" b
    JOIN "devices" d ON d."id" = NEW."device_id"
    JOIN "users" u ON u."id" = NEW."actor_id"
    WHERE b."id" = NEW."branch_id"
      AND b."organization_id" = NEW."organization_id"
      AND d."branch_id" = NEW."branch_id"
      AND d."organization_id" = NEW."organization_id"
      AND d."status" = 'ACTIVE'
      AND u."organization_id" = NEW."organization_id"
      AND u."status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'sync command tenant, actor, or device scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sync_command_scope_guard_trigger"
BEFORE INSERT ON "sync_command_receipts"
FOR EACH ROW EXECUTE FUNCTION "sync_command_scope_guard"();

CREATE OR REPLACE FUNCTION "sync_command_append_only_guard"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'sync command receipts are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sync_command_append_only_update"
BEFORE UPDATE ON "sync_command_receipts"
FOR EACH ROW EXECUTE FUNCTION "sync_command_append_only_guard"();

CREATE TRIGGER "sync_command_append_only_delete"
BEFORE DELETE ON "sync_command_receipts"
FOR EACH ROW EXECUTE FUNCTION "sync_command_append_only_guard"();
