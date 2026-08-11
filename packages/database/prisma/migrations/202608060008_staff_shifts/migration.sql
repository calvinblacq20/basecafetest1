CREATE TYPE "StaffShiftStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "staff_shifts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "current_cashier_id" UUID NOT NULL,
    "drawer_key" VARCHAR(80),
    "business_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "opening_float_minor" INTEGER NOT NULL,
    "opening_denominations" JSONB,
    "status" "StaffShiftStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_shifts_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "staff_shifts_opening_float_check"
      CHECK ("opening_float_minor" BETWEEN 0 AND 2147483647),
    CONSTRAINT "staff_shifts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "staff_shifts_drawer_key_check"
      CHECK ("drawer_key" IS NULL OR "drawer_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$'),
    CONSTRAINT "staff_shifts_status_check" CHECK (
      ("status" = 'OPEN' AND "closed_at" IS NULL) OR
      ("status" = 'CLOSED' AND "closed_at" IS NOT NULL)
    )
);

CREATE TABLE "shift_responsibilities" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "ended_by_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "shift_responsibilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_responsibilities_reason_check" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "shift_responsibilities_end_check" CHECK (
      ("ended_by_id" IS NULL AND "ended_at" IS NULL) OR
      ("ended_by_id" IS NOT NULL AND "ended_at" IS NOT NULL AND "ended_at" >= "started_at")
    )
);

CREATE TABLE "shift_closes" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "counted_cash_minor" INTEGER NOT NULL,
    "expected_cash_minor" INTEGER NOT NULL,
    "variance_minor" INTEGER NOT NULL,
    "closing_denominations" JSONB,
    "declaration" VARCHAR(500) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_closes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_closes_shift_id_key" UNIQUE ("shift_id"),
    CONSTRAINT "shift_closes_money_check" CHECK (
      "counted_cash_minor" BETWEEN 0 AND 2147483647 AND
      "expected_cash_minor" BETWEEN 0 AND 2147483647
    ),
    CONSTRAINT "shift_closes_variance_check"
      CHECK ("variance_minor" = "counted_cash_minor" - "expected_cash_minor"),
    CONSTRAINT "shift_closes_variance_approval_check"
      CHECK ("variance_minor" = 0 OR "approved_by_id" IS NOT NULL),
    CONSTRAINT "shift_closes_text_check" CHECK (
      length(btrim("declaration")) > 0 AND length(btrim("reason")) > 0
    )
);

CREATE INDEX "staff_shifts_branch_id_business_date_status_idx"
  ON "staff_shifts"("branch_id", "business_date", "status");
CREATE INDEX "staff_shifts_device_id_status_idx"
  ON "staff_shifts"("device_id", "status");
CREATE INDEX "staff_shifts_current_cashier_id_status_idx"
  ON "staff_shifts"("current_cashier_id", "status");
CREATE UNIQUE INDEX "staff_shifts_one_open_per_device_key"
  ON "staff_shifts"("device_id") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "staff_shifts_one_open_per_drawer_key"
  ON "staff_shifts"("branch_id", "drawer_key")
  WHERE "status" = 'OPEN' AND "drawer_key" IS NOT NULL;
CREATE UNIQUE INDEX "staff_shifts_one_open_per_cashier_key"
  ON "staff_shifts"("branch_id", "current_cashier_id") WHERE "status" = 'OPEN';
CREATE INDEX "shift_responsibilities_shift_id_started_at_idx"
  ON "shift_responsibilities"("shift_id", "started_at");
CREATE UNIQUE INDEX "shift_responsibilities_one_current_key"
  ON "shift_responsibilities"("shift_id") WHERE "ended_at" IS NULL;

ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "branch_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_opened_by_id_fkey"
  FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_current_cashier_id_fkey"
  FOREIGN KEY ("current_cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_responsibilities" ADD CONSTRAINT "shift_responsibilities_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "staff_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_responsibilities" ADD CONSTRAINT "shift_responsibilities_cashier_id_fkey"
  FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_responsibilities" ADD CONSTRAINT "shift_responsibilities_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_responsibilities" ADD CONSTRAINT "shift_responsibilities_ended_by_id_fkey"
  FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "staff_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION validate_staff_shift_scope()
RETURNS trigger AS $$
DECLARE
  branch_organization_id UUID;
  device_branch_id UUID;
  device_organization_id UUID;
  schedule_branch_id UUID;
  opener_organization_id UUID;
  cashier_organization_id UUID;
BEGIN
  SELECT "organization_id" INTO branch_organization_id FROM "branches" WHERE "id" = NEW."branch_id";
  SELECT "branch_id", "organization_id" INTO device_branch_id, device_organization_id FROM "devices" WHERE "id" = NEW."device_id";
  SELECT "branch_id" INTO schedule_branch_id FROM "branch_schedule_versions" WHERE "id" = NEW."schedule_version_id";
  SELECT "organization_id" INTO opener_organization_id FROM "users" WHERE "id" = NEW."opened_by_id";
  SELECT "organization_id" INTO cashier_organization_id FROM "users" WHERE "id" = NEW."current_cashier_id";
  IF device_branch_id IS DISTINCT FROM NEW."branch_id"
     OR device_organization_id IS DISTINCT FROM branch_organization_id
     OR schedule_branch_id IS DISTINCT FROM NEW."branch_id"
     OR opener_organization_id IS DISTINCT FROM branch_organization_id
     OR cashier_organization_id IS DISTINCT FROM branch_organization_id THEN
    RAISE EXCEPTION 'staff shift branch, device, schedule and users must share tenant scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_shifts_scope_guard"
BEFORE INSERT OR UPDATE ON "staff_shifts"
FOR EACH ROW EXECUTE FUNCTION validate_staff_shift_scope();

CREATE FUNCTION validate_shift_child_scope()
RETURNS trigger AS $$
DECLARE
  branch_organization_id UUID;
  cashier_organization_id UUID;
  actor_organization_id UUID;
BEGIN
  SELECT b."organization_id" INTO branch_organization_id
    FROM "staff_shifts" s JOIN "branches" b ON b."id" = s."branch_id"
    WHERE s."id" = NEW."shift_id";
  IF TG_TABLE_NAME = 'shift_responsibilities' THEN
    SELECT "organization_id" INTO cashier_organization_id FROM "users" WHERE "id" = NEW."cashier_id";
    SELECT "organization_id" INTO actor_organization_id FROM "users" WHERE "id" = COALESCE(NEW."ended_by_id", NEW."assigned_by_id");
  ELSE
    SELECT "organization_id" INTO cashier_organization_id FROM "users" WHERE "id" = NEW."submitted_by_id";
    SELECT "organization_id" INTO actor_organization_id FROM "users" WHERE "id" = COALESCE(NEW."approved_by_id", NEW."submitted_by_id");
  END IF;
  IF branch_organization_id IS NULL
     OR cashier_organization_id IS DISTINCT FROM branch_organization_id
     OR actor_organization_id IS DISTINCT FROM branch_organization_id THEN
    RAISE EXCEPTION 'shift history actors must share the shift tenant scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shift_responsibilities_scope_guard"
BEFORE INSERT OR UPDATE ON "shift_responsibilities"
FOR EACH ROW EXECUTE FUNCTION validate_shift_child_scope();

CREATE TRIGGER "shift_closes_scope_guard"
BEFORE INSERT ON "shift_closes"
FOR EACH ROW EXECUTE FUNCTION validate_shift_child_scope();

CREATE FUNCTION guard_staff_shift_history()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'staff shifts cannot be deleted';
  END IF;
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'closed staff shifts are immutable';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'staff shift revisions must increment by exactly one';
  END IF;
  IF NEW."status" NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'invalid staff shift transition';
  END IF;
  IF ROW(NEW."id", NEW."branch_id", NEW."device_id", NEW."schedule_version_id", NEW."opened_by_id", NEW."drawer_key", NEW."business_date", NEW."currency", NEW."opening_float_minor", NEW."opening_denominations", NEW."opened_at", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."branch_id", OLD."device_id", OLD."schedule_version_id", OLD."opened_by_id", OLD."drawer_key", OLD."business_date", OLD."currency", OLD."opening_float_minor", OLD."opening_denominations", OLD."opened_at", OLD."created_at") THEN
    RAISE EXCEPTION 'staff shift opening facts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_shifts_history_guard"
BEFORE UPDATE OR DELETE ON "staff_shifts"
FOR EACH ROW EXECUTE FUNCTION guard_staff_shift_history();

CREATE FUNCTION guard_shift_responsibility_history()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shift responsibility history cannot be deleted';
  END IF;
  IF OLD."ended_at" IS NOT NULL THEN
    RAISE EXCEPTION 'ended shift responsibility history is immutable';
  END IF;
  IF ROW(NEW."shift_id", NEW."cashier_id", NEW."assigned_by_id", NEW."reason", NEW."started_at")
     IS DISTINCT FROM
     ROW(OLD."shift_id", OLD."cashier_id", OLD."assigned_by_id", OLD."reason", OLD."started_at") THEN
    RAISE EXCEPTION 'shift responsibility assignment facts are immutable';
  END IF;
  IF NEW."ended_by_id" IS NULL OR NEW."ended_at" IS NULL THEN
    RAISE EXCEPTION 'shift responsibility may only be updated to end it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shift_responsibilities_history_guard"
BEFORE UPDATE OR DELETE ON "shift_responsibilities"
FOR EACH ROW EXECUTE FUNCTION guard_shift_responsibility_history();

CREATE FUNCTION guard_shift_close_history()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shift close snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shift_closes_history_guard"
BEFORE UPDATE OR DELETE ON "shift_closes"
FOR EACH ROW EXECUTE FUNCTION guard_shift_close_history();
