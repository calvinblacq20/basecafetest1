ALTER TYPE "OrderStatus" ADD VALUE 'MERGED';
ALTER TYPE "OrderEventType" ADD VALUE 'TABLE_MOVED';
ALTER TYPE "OrderEventType" ADD VALUE 'RESPONSIBILITY_TRANSFERRED';
ALTER TYPE "OrderEventType" ADD VALUE 'MERGED_INTO';
ALTER TYPE "OrderEventType" ADD VALUE 'MERGE_RECEIVED';
ALTER TYPE "OrderEventType" ADD VALUE 'SPLIT_CREATED';
ALTER TYPE "OrderEventType" ADD VALUE 'SPLIT_RECEIVED';

ALTER TABLE "orders"
  ADD COLUMN "assigned_server_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN "merged_at" TIMESTAMPTZ(3);
UPDATE "orders" SET "assigned_server_id" = "created_by_id" WHERE "assigned_server_id" IS NULL;
ALTER TABLE "orders" ALTER COLUMN "assigned_server_id" SET NOT NULL;
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_timestamps";
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_timestamps" CHECK (
  ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "merged_at" IS NULL)
  -- PostgreSQL does not allow a newly-added enum label to be used as an enum
  -- literal until the transaction that added it commits. Compare through text
  -- so this migration remains executable from an empty database.
  OR ("status"::text = 'MERGED' AND "merged_at" IS NOT NULL AND "cancelled_at" IS NULL)
  OR ("status" IN ('OPEN', 'HELD') AND "cancelled_at" IS NULL AND "merged_at" IS NULL)
);

CREATE TABLE "order_table_movements" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "from_table_id" UUID REFERENCES "dining_tables"("id") ON DELETE RESTRICT,
  "to_table_id" UUID REFERENCES "dining_tables"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "conflict_override" BOOLEAN NOT NULL DEFAULT false,
  "conflicting_order_ids" JSONB,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_table_movement_changes_table" CHECK ("from_table_id" IS DISTINCT FROM "to_table_id")
);
CREATE INDEX "order_table_movements_order_created_idx" ON "order_table_movements"("order_id", "created_at");

CREATE TABLE "order_responsibility_transfers" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "from_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "to_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_responsibility_changes_user" CHECK ("from_user_id" <> "to_user_id")
);
CREATE INDEX "order_responsibility_transfers_order_created_idx" ON "order_responsibility_transfers"("order_id", "created_at");

CREATE TABLE "order_merges" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "target_order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "source_order_id" UUID NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_merge_distinct" CHECK ("target_order_id" <> "source_order_id")
);
CREATE INDEX "order_merges_target_created_idx" ON "order_merges"("target_order_id", "created_at");

CREATE TABLE "order_splits" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "source_order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "child_order_id" UUID NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_split_distinct" CHECK ("source_order_id" <> "child_order_id")
);
CREATE INDEX "order_splits_source_created_idx" ON "order_splits"("source_order_id", "created_at");

CREATE TABLE "order_split_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "split_id" UUID NOT NULL REFERENCES "order_splits"("id") ON DELETE RESTRICT,
  "source_line_id" UUID NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "target_line_id" UUID NOT NULL UNIQUE REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "remainder_line_id" UUID UNIQUE REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "source_quantity" INTEGER NOT NULL CHECK ("source_quantity" > 0 AND "source_quantity" <= 99),
  "moved_quantity" INTEGER NOT NULL CHECK ("moved_quantity" > 0 AND "moved_quantity" <= "source_quantity"),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("split_id", "source_line_id"),
  CONSTRAINT "order_split_remainder_required" CHECK (
    ("moved_quantity" = "source_quantity" AND "remainder_line_id" IS NULL)
    OR ("moved_quantity" < "source_quantity" AND "remainder_line_id" IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION enforce_order_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row "staff_shifts"%ROWTYPE; table_branch UUID; profile_branch UUID; server_org UUID; branch_org UUID;
BEGIN
  SELECT * INTO shift_row FROM "staff_shifts" WHERE "id" = NEW."shift_id";
  IF shift_row."branch_id" <> NEW."branch_id" OR shift_row."device_id" <> NEW."device_id" OR shift_row."business_date" <> NEW."business_date" OR shift_row."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'order shift snapshot scope mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  SELECT "organization_id" INTO server_org FROM "users" WHERE "id" = NEW."assigned_server_id";
  IF server_org IS NULL OR server_org <> branch_org THEN RAISE EXCEPTION 'order assigned server tenant mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW."table_id" IS NOT NULL THEN
    SELECT "branch_id" INTO table_branch FROM "dining_tables" WHERE "id" = NEW."table_id";
    IF table_branch <> NEW."branch_id" THEN RAISE EXCEPTION 'order table branch mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."tax_profile_id" IS NOT NULL THEN
    SELECT "branch_id" INTO profile_branch FROM "tax_profiles" WHERE "id" = NEW."tax_profile_id";
    IF profile_branch <> NEW."branch_id" THEN RAISE EXCEPTION 'order tax profile branch mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

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
  IF OLD."status"::text IN ('CANCELLED','MERGED') OR NOT (
    (OLD."status"::text = 'OPEN' AND NEW."status"::text IN ('OPEN','HELD','CANCELLED','MERGED'))
    OR (OLD."status"::text = 'HELD' AND NEW."status"::text IN ('OPEN','HELD','CANCELLED','MERGED'))
  ) THEN RAISE EXCEPTION 'invalid order lifecycle transition' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION enforce_order_operation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_branch UUID; actor_org UUID; branch_org UUID; device_branch UUID; from_branch UUID; to_branch UUID; from_org UUID; to_org UUID;
BEGIN
  SELECT "branch_id" INTO order_branch FROM "orders" WHERE "id" = NEW."order_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."actor_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  SELECT "branch_id" INTO device_branch FROM "devices" WHERE "id" = NEW."device_id";
  IF order_branch IS NULL OR order_branch <> NEW."branch_id" OR actor_org <> branch_org OR device_branch <> NEW."branch_id" THEN
    RAISE EXCEPTION 'order operation tenant or branch mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'order_table_movements' THEN
    IF NEW."from_table_id" IS NOT NULL THEN SELECT "branch_id" INTO from_branch FROM "dining_tables" WHERE "id" = NEW."from_table_id"; END IF;
    IF NEW."to_table_id" IS NOT NULL THEN SELECT "branch_id" INTO to_branch FROM "dining_tables" WHERE "id" = NEW."to_table_id"; END IF;
    IF (NEW."from_table_id" IS NOT NULL AND from_branch <> NEW."branch_id") OR (NEW."to_table_id" IS NOT NULL AND to_branch <> NEW."branch_id") THEN
      RAISE EXCEPTION 'order table movement branch mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'order_responsibility_transfers' THEN
    SELECT "organization_id" INTO from_org FROM "users" WHERE "id" = NEW."from_user_id";
    SELECT "organization_id" INTO to_org FROM "users" WHERE "id" = NEW."to_user_id";
    IF from_org <> branch_org OR to_org <> branch_org THEN RAISE EXCEPTION 'order responsibility tenant mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_table_movements_scope_guard BEFORE INSERT ON "order_table_movements" FOR EACH ROW EXECUTE FUNCTION enforce_order_operation_scope();
CREATE TRIGGER order_responsibility_scope_guard BEFORE INSERT ON "order_responsibility_transfers" FOR EACH ROW EXECUTE FUNCTION enforce_order_operation_scope();

CREATE FUNCTION enforce_order_merge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_row "orders"%ROWTYPE; source_row "orders"%ROWTYPE; actor_org UUID; branch_org UUID; device_branch UUID;
BEGIN
  SELECT * INTO target_row FROM "orders" WHERE "id" = NEW."target_order_id";
  SELECT * INTO source_row FROM "orders" WHERE "id" = NEW."source_order_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."actor_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  SELECT "branch_id" INTO device_branch FROM "devices" WHERE "id" = NEW."device_id";
  IF target_row."branch_id" <> NEW."branch_id" OR source_row."branch_id" <> NEW."branch_id" OR
     target_row."shift_id" <> source_row."shift_id" OR target_row."business_date" <> source_row."business_date" OR
     target_row."currency" <> source_row."currency" OR target_row."channel" <> source_row."channel" OR
     target_row."tax_profile_id" IS DISTINCT FROM source_row."tax_profile_id" OR actor_org <> branch_org OR device_branch <> NEW."branch_id" THEN
    RAISE EXCEPTION 'incompatible order merge scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_merges_scope_guard BEFORE INSERT ON "order_merges" FOR EACH ROW EXECUTE FUNCTION enforce_order_merge_scope();

CREATE FUNCTION enforce_order_split_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row "orders"%ROWTYPE; child_row "orders"%ROWTYPE; actor_org UUID; branch_org UUID; device_branch UUID;
BEGIN
  SELECT * INTO source_row FROM "orders" WHERE "id" = NEW."source_order_id";
  SELECT * INTO child_row FROM "orders" WHERE "id" = NEW."child_order_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."actor_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  SELECT "branch_id" INTO device_branch FROM "devices" WHERE "id" = NEW."device_id";
  IF source_row."branch_id" <> NEW."branch_id" OR child_row."branch_id" <> NEW."branch_id" OR
     source_row."shift_id" <> child_row."shift_id" OR source_row."business_date" <> child_row."business_date" OR
     source_row."currency" <> child_row."currency" OR source_row."channel" <> child_row."channel" OR
     source_row."tax_profile_id" IS DISTINCT FROM child_row."tax_profile_id" OR actor_org <> branch_org OR device_branch <> NEW."branch_id" THEN
    RAISE EXCEPTION 'incompatible order split scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_splits_scope_guard BEFORE INSERT ON "order_splits" FOR EACH ROW EXECUTE FUNCTION enforce_order_split_scope();

CREATE FUNCTION enforce_order_split_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_order UUID; target_order UUID; remainder_order UUID; split_source UUID; split_child UUID; source_qty INTEGER;
BEGIN
  SELECT "source_order_id", "child_order_id" INTO split_source, split_child FROM "order_splits" WHERE "id" = NEW."split_id";
  SELECT "order_id", "quantity" INTO source_order, source_qty FROM "order_lines" WHERE "id" = NEW."source_line_id";
  SELECT "order_id" INTO target_order FROM "order_lines" WHERE "id" = NEW."target_line_id";
  IF NEW."remainder_line_id" IS NOT NULL THEN SELECT "order_id" INTO remainder_order FROM "order_lines" WHERE "id" = NEW."remainder_line_id"; END IF;
  IF source_order <> split_source OR target_order <> split_child OR source_qty <> NEW."source_quantity" OR
     (NEW."remainder_line_id" IS NOT NULL AND remainder_order <> split_source) THEN
    RAISE EXCEPTION 'order split line lineage mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_split_lines_scope_guard BEFORE INSERT ON "order_split_lines" FOR EACH ROW EXECUTE FUNCTION enforce_order_split_line_scope();

CREATE TRIGGER order_table_movements_append_only BEFORE UPDATE OR DELETE ON "order_table_movements" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_responsibility_transfers_append_only BEFORE UPDATE OR DELETE ON "order_responsibility_transfers" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_merges_append_only BEFORE UPDATE OR DELETE ON "order_merges" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_splits_append_only BEFORE UPDATE OR DELETE ON "order_splits" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_split_lines_append_only BEFORE UPDATE OR DELETE ON "order_split_lines" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
