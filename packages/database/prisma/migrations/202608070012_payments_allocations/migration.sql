ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "OrderEventType" ADD VALUE 'COMPLETED';

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MANUAL_MOMO', 'EXTERNAL_CARD', 'BANK_TRANSFER');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_VERIFICATION', 'CONFIRMED', 'FAILED', 'CANCELLED');
CREATE TYPE "PaymentEventType" AS ENUM ('CREATED', 'VERIFICATION_CONFIRMED', 'VERIFICATION_FAILED', 'CANCELLED');

ALTER TABLE "orders"
  ADD COLUMN "completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "completed_by_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_timestamps";
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_timestamps" CHECK (
  ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "merged_at" IS NULL AND "completed_at" IS NULL AND "completed_by_id" IS NULL)
  OR ("status" = 'MERGED' AND "merged_at" IS NOT NULL AND "cancelled_at" IS NULL AND "completed_at" IS NULL AND "completed_by_id" IS NULL)
  -- COMPLETED is added above in this migration. Compare through text until
  -- PostgreSQL commits the new enum label.
  OR ("status"::text = 'COMPLETED' AND "completed_at" IS NOT NULL AND "completed_by_id" IS NOT NULL AND "cancelled_at" IS NULL AND "merged_at" IS NULL)
  OR ("status" IN ('OPEN', 'HELD') AND "cancelled_at" IS NULL AND "merged_at" IS NULL AND "completed_at" IS NULL AND "completed_by_id" IS NULL)
);

CREATE TABLE "payments" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "shift_id" UUID NOT NULL REFERENCES "staff_shifts"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" > 0 AND "amount_minor" <= 2000000000),
  "tendered_amount_minor" INTEGER,
  "change_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("change_minor" >= 0),
  "external_reference" VARCHAR(160),
  "network" VARCHAR(80),
  "merchant_account_reference" VARCHAR(120),
  "evidence_note" VARCHAR(500),
  "confirmed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_method_fields" CHECK (
    ("method" = 'CASH' AND "tendered_amount_minor" IS NOT NULL AND "tendered_amount_minor" >= "amount_minor" AND "change_minor" = "tendered_amount_minor" - "amount_minor" AND "external_reference" IS NULL)
    OR ("method" <> 'CASH' AND "tendered_amount_minor" IS NULL AND "change_minor" = 0 AND "external_reference" IS NOT NULL)
  ),
  CONSTRAINT "payments_status_timestamps" CHECK (
    ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "failed_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'FAILED' AND "confirmed_at" IS NULL AND "failed_at" IS NOT NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "confirmed_at" IS NULL AND "failed_at" IS NULL AND "cancelled_at" IS NOT NULL)
    OR ("status" IN ('PENDING','REQUIRES_VERIFICATION') AND "confirmed_at" IS NULL AND "failed_at" IS NULL AND "cancelled_at" IS NULL)
  ),
  UNIQUE ("branch_id", "method", "external_reference")
);
CREATE INDEX "payments_branch_status_created_idx" ON "payments"("branch_id", "status", "created_at");
CREATE INDEX "payments_order_created_idx" ON "payments"("order_id", "created_at");
CREATE INDEX "payments_shift_status_method_idx" ON "payments"("shift_id", "status", "method");

CREATE TABLE "payment_allocations" (
  "id" UUID PRIMARY KEY,
  "payment_id" UUID NOT NULL REFERENCES "payments"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" > 0 AND "amount_minor" <= 2000000000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("payment_id", "order_id")
);
CREATE INDEX "payment_allocations_order_created_idx" ON "payment_allocations"("order_id", "created_at");

CREATE TABLE "payment_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL REFERENCES "payments"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL,
  "type" "PaymentEventType" NOT NULL,
  "from_status" "PaymentStatus",
  "to_status" "PaymentStatus" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "data" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payment_events_payment_occurred_idx" ON "payment_events"("payment_id", "occurred_at");

CREATE TABLE "payment_verifications" (
  "id" UUID PRIMARY KEY,
  "payment_id" UUID NOT NULL UNIQUE REFERENCES "payments"("id") ON DELETE RESTRICT,
  "verifier_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL,
  "decision" VARCHAR(16) NOT NULL CHECK ("decision" IN ('CONFIRM','FAIL')),
  "evidence_note" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION enforce_payment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_row "orders"%ROWTYPE; shift_row "staff_shifts"%ROWTYPE; device_branch UUID; actor_org UUID; branch_org UUID;
BEGIN
  SELECT * INTO order_row FROM "orders" WHERE "id" = NEW."order_id";
  SELECT * INTO shift_row FROM "staff_shifts" WHERE "id" = NEW."shift_id";
  SELECT "branch_id" INTO device_branch FROM "devices" WHERE "id" = NEW."device_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."created_by_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  IF order_row."branch_id" <> NEW."branch_id" OR shift_row."branch_id" <> NEW."branch_id" OR
     device_branch <> NEW."branch_id" OR actor_org <> branch_org OR
     order_row."currency" <> NEW."currency" OR shift_row."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'payment tenant, branch, or currency mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_scope_guard BEFORE INSERT OR UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION enforce_payment_scope();

CREATE FUNCTION enforce_payment_allocation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE anchor_order UUID; anchor_branch UUID; allocated_branch UUID; linked INTEGER;
BEGIN
  SELECT "order_id", "branch_id" INTO anchor_order, anchor_branch FROM "payments" WHERE "id" = NEW."payment_id";
  SELECT "branch_id" INTO allocated_branch FROM "orders" WHERE "id" = NEW."order_id";
  SELECT 1 INTO linked FROM "order_merges" WHERE "target_order_id" = anchor_order AND "source_order_id" = NEW."order_id";
  IF anchor_branch IS NULL OR allocated_branch <> anchor_branch OR (NEW."order_id" <> anchor_order AND linked IS NULL) THEN
    RAISE EXCEPTION 'payment allocation order scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_allocations_scope_guard BEFORE INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_scope();

CREATE FUNCTION enforce_payment_allocation_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment UUID; expected INTEGER; allocated BIGINT;
BEGIN
  target_payment := COALESCE(NEW."payment_id", OLD."payment_id");
  SELECT "amount_minor" INTO expected FROM "payments" WHERE "id" = target_payment;
  SELECT COALESCE(SUM("amount_minor"),0) INTO allocated FROM "payment_allocations" WHERE "payment_id" = target_payment;
  IF allocated <> expected THEN RAISE EXCEPTION 'payment allocations do not reconcile' USING ERRCODE = '23514'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE CONSTRAINT TRIGGER payment_allocations_reconcile
AFTER INSERT OR UPDATE ON "payment_allocations" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_totals();

CREATE FUNCTION enforce_confirmed_order_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated_order UUID; order_total INTEGER; confirmed_total BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'payment_allocations' THEN
    allocated_order := COALESCE(NEW."order_id", OLD."order_id");
    SELECT "gross_total_minor" INTO order_total FROM "orders" WHERE "id" = allocated_order;
    SELECT COALESCE(SUM(a."amount_minor"),0) INTO confirmed_total
      FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."payment_id"
      WHERE a."order_id" = allocated_order AND p."status" = 'CONFIRMED';
    IF confirmed_total > order_total THEN RAISE EXCEPTION 'confirmed payment exceeds order total' USING ERRCODE = '23514'; END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOR allocated_order IN SELECT DISTINCT "order_id" FROM "payment_allocations" WHERE "payment_id" = NEW."id"
  LOOP
    SELECT "gross_total_minor" INTO order_total FROM "orders" WHERE "id" = allocated_order;
    SELECT COALESCE(SUM(a."amount_minor"),0) INTO confirmed_total
      FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."payment_id"
      WHERE a."order_id" = allocated_order AND p."status" = 'CONFIRMED';
    IF confirmed_total > order_total THEN
      RAISE EXCEPTION 'confirmed payment exceeds order total' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE CONSTRAINT TRIGGER payment_allocation_balance_guard
AFTER INSERT OR UPDATE ON "payment_allocations" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_order_balance();
CREATE CONSTRAINT TRIGGER payment_status_balance_guard
AFTER UPDATE OF "status" ON "payments" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_order_balance();

CREATE FUNCTION enforce_payment_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'payment revision must increment exactly once' USING ERRCODE = '23514'; END IF;
  IF (NEW."id",NEW."branch_id",NEW."order_id",NEW."shift_id",NEW."device_id",NEW."created_by_id",NEW."method",NEW."currency",NEW."amount_minor",NEW."tendered_amount_minor",NEW."change_minor",NEW."external_reference",NEW."network",NEW."merchant_account_reference") IS DISTINCT FROM
     (OLD."id",OLD."branch_id",OLD."order_id",OLD."shift_id",OLD."device_id",OLD."created_by_id",OLD."method",OLD."currency",OLD."amount_minor",OLD."tendered_amount_minor",OLD."change_minor",OLD."external_reference",OLD."network",OLD."merchant_account_reference") THEN
    RAISE EXCEPTION 'immutable payment facts changed' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'REQUIRES_VERIFICATION' OR NEW."status" NOT IN ('CONFIRMED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'invalid payment lifecycle transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_lifecycle_guard BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION enforce_payment_lifecycle();

CREATE OR REPLACE FUNCTION enforce_order_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'order revision must increment exactly once' USING ERRCODE = '23514'; END IF;
  IF (NEW."id", NEW."branch_id", NEW."shift_id", NEW."device_id", NEW."created_by_id", NEW."business_date", NEW."currency", NEW."order_sequence", NEW."order_number", NEW."client_reference", NEW."channel") IS DISTINCT FROM
     (OLD."id", OLD."branch_id", OLD."shift_id", OLD."device_id", OLD."created_by_id", OLD."business_date", OLD."currency", OLD."order_sequence", OLD."order_number", OLD."client_reference", OLD."channel") THEN
    RAISE EXCEPTION 'immutable order identity changed' USING ERRCODE = '23514';
  END IF;
  IF OLD."tax_profile_id" IS NOT NULL AND (NEW."tax_profile_id", NEW."tax_profile_key_snapshot", NEW."tax_profile_name_snapshot", NEW."tax_profile_revision", NEW."tax_price_mode", NEW."tax_rounding_mode", NEW."tax_rounding_scope") IS DISTINCT FROM
    (OLD."tax_profile_id", OLD."tax_profile_key_snapshot", OLD."tax_profile_name_snapshot", OLD."tax_profile_revision", OLD."tax_price_mode", OLD."tax_rounding_mode", OLD."tax_rounding_scope") THEN
    RAISE EXCEPTION 'pinned tax snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status"::text IN ('CANCELLED','MERGED','COMPLETED') OR NOT (
    (OLD."status"::text = 'OPEN' AND NEW."status"::text IN ('OPEN','HELD','CANCELLED','MERGED','COMPLETED'))
    OR (OLD."status"::text = 'HELD' AND NEW."status"::text IN ('OPEN','HELD','CANCELLED','MERGED','COMPLETED'))
  ) THEN RAISE EXCEPTION 'invalid order lifecycle transition' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payment_verifications_append_only BEFORE UPDATE OR DELETE ON "payment_verifications" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
