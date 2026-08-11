CREATE TYPE "CashMovementType" AS ENUM ('PAID_IN','PAID_OUT','BANK_DROP','CORRECTION');
CREATE TYPE "CashMovementDirection" AS ENUM ('IN','OUT');
CREATE TYPE "CashMovementStatus" AS ENUM ('AWAITING_APPROVAL','POSTED','REJECTED');

CREATE TABLE "cash_movements" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "shift_id" UUID NOT NULL REFERENCES "staff_shifts"("id") ON DELETE RESTRICT,
  "requested_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "type" "CashMovementType" NOT NULL,
  "direction" "CashMovementDirection" NOT NULL,
  "status" "CashMovementStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" > 0 AND "amount_minor" <= 2000000000),
  "reference" VARCHAR(160),
  "evidence_note" VARCHAR(500) NOT NULL CHECK (length(trim("evidence_note")) > 0),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason")) > 0),
  "posted_at" TIMESTAMPTZ(3),
  "rejected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_movement_type_direction" CHECK (
    ("type" = 'PAID_IN' AND "direction" = 'IN') OR
    ("type" IN ('PAID_OUT','BANK_DROP') AND "direction" = 'OUT') OR
    ("type" = 'CORRECTION')
  ),
  CONSTRAINT "cash_movement_status_timestamps" CHECK (
    ("status" = 'AWAITING_APPROVAL' AND "posted_at" IS NULL AND "rejected_at" IS NULL) OR
    ("status" = 'POSTED' AND "posted_at" IS NOT NULL AND "rejected_at" IS NULL) OR
    ("status" = 'REJECTED' AND "rejected_at" IS NOT NULL AND "posted_at" IS NULL)
  )
);

CREATE INDEX "cash_movements_branch_status_created_idx"
  ON "cash_movements"("branch_id", "status", "created_at");
CREATE INDEX "cash_movements_shift_status_idx"
  ON "cash_movements"("shift_id", "status");

CREATE TABLE "cash_movement_approvals" (
  "id" UUID PRIMARY KEY,
  "movement_id" UUID NOT NULL UNIQUE REFERENCES "cash_movements"("id") ON DELETE RESTRICT,
  "approver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "decision" VARCHAR(16) NOT NULL CHECK ("decision" IN ('APPROVE','REJECT')),
  "evidence_note" VARCHAR(500) NOT NULL CHECK (length(trim("evidence_note")) > 0),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason")) > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION enforce_cash_movement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  shift_row "staff_shifts"%ROWTYPE;
  actor_org UUID;
  branch_org UUID;
BEGIN
  SELECT * INTO shift_row FROM "staff_shifts" WHERE "id" = NEW."shift_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."requested_by_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  IF shift_row."id" IS NULL OR shift_row."branch_id" <> NEW."branch_id"
     OR shift_row."status" <> 'OPEN' OR shift_row."currency" <> NEW."currency"
     OR actor_org IS NULL OR actor_org <> branch_org THEN
    RAISE EXCEPTION 'cash movement tenant, currency, or open shift mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cash_movements_scope_guard
  BEFORE INSERT ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_cash_movement_scope();

CREATE FUNCTION enforce_cash_movement_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> OLD."revision" + 1 OR
     (NEW."id", NEW."branch_id", NEW."shift_id", NEW."requested_by_id", NEW."type", NEW."direction",
      NEW."currency", NEW."amount_minor", NEW."reference", NEW."evidence_note", NEW."reason", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."branch_id", OLD."shift_id", OLD."requested_by_id", OLD."type", OLD."direction",
      OLD."currency", OLD."amount_minor", OLD."reference", OLD."evidence_note", OLD."reason", OLD."created_at") THEN
    RAISE EXCEPTION 'invalid cash movement mutation' USING ERRCODE = '23514';
  END IF;
  IF NOT (OLD."status" = 'AWAITING_APPROVAL' AND NEW."status" IN ('POSTED','REJECTED')) THEN
    RAISE EXCEPTION 'invalid cash movement transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cash_movements_lifecycle_guard
  BEFORE UPDATE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_cash_movement_lifecycle();

CREATE FUNCTION enforce_cash_movement_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  movement_row "cash_movements"%ROWTYPE;
  approver_org UUID;
  branch_org UUID;
  device_org UUID;
  device_branch UUID;
BEGIN
  SELECT * INTO movement_row FROM "cash_movements" WHERE "id" = NEW."movement_id";
  SELECT "organization_id" INTO approver_org FROM "users" WHERE "id" = NEW."approver_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = movement_row."branch_id";
  SELECT "organization_id", "branch_id" INTO device_org, device_branch FROM "devices" WHERE "id" = NEW."device_id";
  IF movement_row."requested_by_id" = NEW."approver_id" OR approver_org <> branch_org
     OR device_org <> branch_org OR device_branch <> movement_row."branch_id"
     OR (NEW."decision" = 'APPROVE' AND movement_row."status" <> 'POSTED')
     OR (NEW."decision" = 'REJECT' AND movement_row."status" <> 'REJECTED') THEN
    RAISE EXCEPTION 'invalid cash movement approval separation or scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cash_movement_approvals_guard
  BEFORE INSERT ON "cash_movement_approvals"
  FOR EACH ROW EXECUTE FUNCTION enforce_cash_movement_approval();

CREATE TRIGGER cash_movements_no_delete
  BEFORE DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER cash_movement_approvals_append_only
  BEFORE UPDATE OR DELETE ON "cash_movement_approvals"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
