CREATE TYPE "OrderChannel" AS ENUM ('DINE_IN', 'TAKEAWAY', 'PHONE_DELIVERY', 'BAR_TAB');
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'HELD', 'CANCELLED');
CREATE TYPE "OrderLineStatus" AS ENUM ('DRAFT', 'REPLACED', 'REMOVED');
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'HELD', 'RESUMED', 'CANCELLED', 'LINE_ADDED', 'LINE_REPLACED', 'LINE_REMOVED', 'TABLE_CONFLICT_OVERRIDDEN');

CREATE TABLE "branch_order_sequences" (
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "business_date" DATE NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0 CHECK ("last_value" >= 0),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("branch_id", "business_date")
);

CREATE TABLE "orders" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "shift_id" UUID NOT NULL REFERENCES "staff_shifts"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "tax_profile_id" UUID REFERENCES "tax_profiles"("id") ON DELETE RESTRICT,
  "table_id" UUID REFERENCES "dining_tables"("id") ON DELETE RESTRICT,
  "channel" "OrderChannel" NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "business_date" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "order_sequence" INTEGER NOT NULL CHECK ("order_sequence" > 0),
  "order_number" VARCHAR(32) NOT NULL,
  "client_reference" VARCHAR(64) NOT NULL,
  "guest_count" INTEGER CHECK ("guest_count" > 0 AND "guest_count" <= 100),
  "pickup_reference" VARCHAR(120),
  "customer_reference" VARCHAR(120),
  "customer_phone" VARCHAR(40),
  "delivery_directions" VARCHAR(500),
  "tab_name" VARCHAR(120),
  "note" VARCHAR(1000),
  "table_conflict_override" BOOLEAN NOT NULL DEFAULT false,
  "tax_profile_key_snapshot" VARCHAR(80),
  "tax_profile_name_snapshot" VARCHAR(120),
  "tax_profile_revision" INTEGER,
  "tax_price_mode" "TaxPriceMode",
  "tax_rounding_mode" "TaxRoundingMode",
  "tax_rounding_scope" "TaxRoundingScope",
  "input_subtotal_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("input_subtotal_minor" >= 0),
  "net_total_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("net_total_minor" >= 0),
  "tax_total_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("tax_total_minor" >= 0),
  "gross_total_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("gross_total_minor" >= 0),
  "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "held_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_totals_reconcile" CHECK ("gross_total_minor" = "net_total_minor" + "tax_total_minor"),
  CONSTRAINT "orders_tax_snapshot_complete" CHECK (
    ("tax_profile_id" IS NULL AND "tax_profile_key_snapshot" IS NULL AND "tax_profile_name_snapshot" IS NULL AND "tax_profile_revision" IS NULL AND "tax_price_mode" IS NULL AND "tax_rounding_mode" IS NULL AND "tax_rounding_scope" IS NULL)
    OR
    ("tax_profile_id" IS NOT NULL AND "tax_profile_key_snapshot" IS NOT NULL AND "tax_profile_name_snapshot" IS NOT NULL AND "tax_profile_revision" IS NOT NULL AND "tax_price_mode" IS NOT NULL AND "tax_rounding_mode" IS NOT NULL AND "tax_rounding_scope" IS NOT NULL)
  ),
  CONSTRAINT "orders_channel_fields" CHECK (
    ("channel" = 'PHONE_DELIVERY' AND "customer_reference" IS NOT NULL AND "table_id" IS NULL AND "tab_name" IS NULL)
    OR ("channel" = 'BAR_TAB' AND "tab_name" IS NOT NULL)
    OR ("channel" = 'DINE_IN' AND "tab_name" IS NULL AND "customer_phone" IS NULL AND "delivery_directions" IS NULL)
    OR ("channel" = 'TAKEAWAY' AND "table_id" IS NULL AND "tab_name" IS NULL AND "guest_count" IS NULL AND "customer_phone" IS NULL AND "delivery_directions" IS NULL)
  ),
  CONSTRAINT "orders_status_timestamps" CHECK (
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
    OR ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL)
  ),
  UNIQUE ("branch_id", "business_date", "order_sequence"),
  UNIQUE ("branch_id", "order_number"),
  UNIQUE ("device_id", "client_reference")
);
CREATE INDEX "orders_branch_business_date_status_idx" ON "orders"("branch_id", "business_date", "status");
CREATE INDEX "orders_shift_status_idx" ON "orders"("shift_id", "status");
CREATE INDEX "orders_table_status_idx" ON "orders"("table_id", "status");
CREATE UNIQUE INDEX "orders_one_normal_active_per_table" ON "orders"("table_id")
  WHERE "table_id" IS NOT NULL AND "status" IN ('OPEN', 'HELD') AND "table_conflict_override" = false;

CREATE TABLE "order_lines" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "replaces_line_id" UUID REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "menu_item_id" UUID NOT NULL REFERENCES "menu_items"("id") ON DELETE RESTRICT,
  "variant_id" UUID REFERENCES "menu_variants"("id") ON DELETE RESTRICT,
  "station_id" UUID REFERENCES "stations"("id") ON DELETE RESTRICT,
  "tax_class_id" UUID NOT NULL REFERENCES "tax_classes"("id") ON DELETE RESTRICT,
  "status" "OrderLineStatus" NOT NULL DEFAULT 'DRAFT',
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0 AND "quantity" <= 99),
  "note" VARCHAR(500),
  "item_name_snapshot" VARCHAR(140) NOT NULL,
  "item_sku_snapshot" VARCHAR(80),
  "variant_name_snapshot" VARCHAR(100),
  "station_name_snapshot" VARCHAR(100),
  "tax_class_key_snapshot" VARCHAR(80) NOT NULL,
  "tax_class_label_snapshot" VARCHAR(120) NOT NULL,
  "tax_treatment_snapshot" "TaxTreatment" NOT NULL,
  "base_unit_price_minor" INTEGER NOT NULL CHECK ("base_unit_price_minor" >= 0),
  "modifier_unit_total_minor" INTEGER NOT NULL CHECK ("modifier_unit_total_minor" >= 0),
  "unit_input_amount_minor" INTEGER NOT NULL CHECK ("unit_input_amount_minor" >= 0),
  "line_input_amount_minor" INTEGER NOT NULL CHECK ("line_input_amount_minor" >= 0),
  "net_amount_minor" INTEGER NOT NULL CHECK ("net_amount_minor" >= 0),
  "tax_total_minor" INTEGER NOT NULL CHECK ("tax_total_minor" >= 0),
  "gross_amount_minor" INTEGER NOT NULL CHECK ("gross_amount_minor" >= 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "order_lines_input_reconcile" CHECK ("unit_input_amount_minor" = "base_unit_price_minor" + "modifier_unit_total_minor" AND "line_input_amount_minor" = "unit_input_amount_minor" * "quantity"),
  CONSTRAINT "order_lines_tax_reconcile" CHECK ("gross_amount_minor" = "net_amount_minor" + "tax_total_minor"),
  CONSTRAINT "order_lines_status_end" CHECK (("status" = 'DRAFT' AND "ended_at" IS NULL) OR ("status" <> 'DRAFT' AND "ended_at" IS NOT NULL)),
  UNIQUE ("order_id", "replaces_line_id")
);
CREATE INDEX "order_lines_order_status_created_idx" ON "order_lines"("order_id", "status", "created_at");

CREATE TABLE "order_line_modifiers" (
  "id" UUID PRIMARY KEY,
  "order_line_id" UUID NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "menu_modifier_id" UUID NOT NULL REFERENCES "menu_modifiers"("id") ON DELETE RESTRICT,
  "modifier_group_id" UUID NOT NULL REFERENCES "modifier_groups"("id") ON DELETE RESTRICT,
  "station_id" UUID REFERENCES "stations"("id") ON DELETE RESTRICT,
  "modifier_name_snapshot" VARCHAR(100) NOT NULL,
  "modifier_group_name_snapshot" VARCHAR(100) NOT NULL,
  "station_name_snapshot" VARCHAR(100),
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "configured_delta_minor" INTEGER NOT NULL CHECK ("configured_delta_minor" >= 0),
  "charged_delta_minor" INTEGER NOT NULL CHECK ("charged_delta_minor" >= 0),
  "is_free" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_line_modifier_free_charge" CHECK (("is_free" AND "charged_delta_minor" = 0) OR NOT "is_free")
);
CREATE INDEX "order_line_modifiers_order_line_idx" ON "order_line_modifiers"("order_line_id");

CREATE TABLE "order_line_tax_components" (
  "id" UUID PRIMARY KEY,
  "order_line_id" UUID NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "tax_profile_component_id" UUID NOT NULL REFERENCES "tax_components"("id") ON DELETE RESTRICT,
  "code_snapshot" VARCHAR(80) NOT NULL,
  "receipt_label_snapshot" VARCHAR(80) NOT NULL,
  "rate_ppm_snapshot" INTEGER NOT NULL CHECK ("rate_ppm_snapshot" BETWEEN 0 AND 1000000),
  "calculation_order_snapshot" INTEGER NOT NULL CHECK ("calculation_order_snapshot" >= 0),
  "taxable_base_minor" INTEGER NOT NULL CHECK ("taxable_base_minor" >= 0),
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" >= 0),
  "rounding_adjustment_minor" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("order_line_id", "code_snapshot")
);

CREATE TABLE "order_events" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL,
  "type" "OrderEventType" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "data" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "order_events_order_occurred_idx" ON "order_events"("order_id", "occurred_at");

CREATE TABLE "order_table_conflicts" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "table_id" UUID NOT NULL,
  "conflicting_order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "approved_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_table_conflict_distinct" CHECK ("order_id" <> "conflicting_order_id"),
  UNIQUE ("order_id", "conflicting_order_id")
);
CREATE INDEX "order_table_conflicts_table_created_idx" ON "order_table_conflicts"("table_id", "created_at");

CREATE FUNCTION enforce_order_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row "staff_shifts"%ROWTYPE; table_branch UUID; profile_branch UUID;
BEGIN
  SELECT * INTO shift_row FROM "staff_shifts" WHERE "id" = NEW."shift_id";
  IF shift_row."branch_id" <> NEW."branch_id" OR shift_row."device_id" <> NEW."device_id" OR shift_row."business_date" <> NEW."business_date" OR shift_row."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'order shift snapshot scope mismatch' USING ERRCODE = '23514';
  END IF;
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
CREATE TRIGGER orders_scope_guard BEFORE INSERT OR UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION enforce_order_scope();

CREATE FUNCTION enforce_order_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD."status" = 'CANCELLED' OR NOT ((OLD."status" = 'OPEN' AND NEW."status" IN ('OPEN','HELD','CANCELLED')) OR (OLD."status" = 'HELD' AND NEW."status" IN ('OPEN','HELD','CANCELLED'))) THEN
    RAISE EXCEPTION 'invalid order lifecycle transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_lifecycle_guard BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION enforce_order_lifecycle();


CREATE FUNCTION enforce_order_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_branch UUID; item_branch UUID; item_id UUID; tax_branch UUID; station_branch UUID;
BEGIN
  SELECT "branch_id" INTO order_branch FROM "orders" WHERE "id" = NEW."order_id";
  SELECT "branch_id" INTO item_branch FROM "menu_items" WHERE "id" = NEW."menu_item_id";
  SELECT "branch_id" INTO tax_branch FROM "tax_classes" WHERE "id" = NEW."tax_class_id";
  IF order_branch IS NULL OR item_branch <> order_branch OR tax_branch <> order_branch THEN
    RAISE EXCEPTION 'order line tenant or branch mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."variant_id" IS NOT NULL THEN
    SELECT "menu_item_id" INTO item_id FROM "menu_variants" WHERE "id" = NEW."variant_id";
    IF item_id <> NEW."menu_item_id" THEN RAISE EXCEPTION 'order line variant mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."station_id" IS NOT NULL THEN
    SELECT "branch_id" INTO station_branch FROM "stations" WHERE "id" = NEW."station_id";
    IF station_branch <> order_branch THEN RAISE EXCEPTION 'order line station mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_lines_scope_guard BEFORE INSERT OR UPDATE ON "order_lines" FOR EACH ROW EXECUTE FUNCTION enforce_order_line_scope();

CREATE FUNCTION enforce_order_modifier_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_group UUID; group_branch UUID; order_branch UUID; line_item UUID; attached INTEGER;
BEGIN
  SELECT "modifier_group_id" INTO expected_group FROM "menu_modifiers" WHERE "id" = NEW."menu_modifier_id";
  SELECT "branch_id" INTO group_branch FROM "modifier_groups" WHERE "id" = NEW."modifier_group_id";
  SELECT o."branch_id", l."menu_item_id" INTO order_branch, line_item FROM "order_lines" l JOIN "orders" o ON o."id" = l."order_id" WHERE l."id" = NEW."order_line_id";
  SELECT 1 INTO attached FROM "menu_item_modifier_groups" WHERE "menu_item_id" = line_item AND "modifier_group_id" = NEW."modifier_group_id";
  IF expected_group <> NEW."modifier_group_id" OR group_branch <> order_branch OR attached IS NULL THEN
    RAISE EXCEPTION 'order modifier attachment or branch mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_line_modifiers_scope_guard BEFORE INSERT ON "order_line_modifiers" FOR EACH ROW EXECUTE FUNCTION enforce_order_modifier_scope();

CREATE FUNCTION enforce_order_tax_component_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE component_profile UUID; order_profile UUID;
BEGIN
  SELECT "tax_profile_id" INTO component_profile FROM "tax_components" WHERE "id" = NEW."tax_profile_component_id";
  SELECT o."tax_profile_id" INTO order_profile FROM "order_lines" l JOIN "orders" o ON o."id" = l."order_id" WHERE l."id" = NEW."order_line_id";
  IF component_profile IS NULL OR component_profile <> order_profile THEN
    RAISE EXCEPTION 'order tax component profile mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_line_taxes_scope_guard BEFORE INSERT ON "order_line_tax_components" FOR EACH ROW EXECUTE FUNCTION enforce_order_tax_component_scope();

CREATE FUNCTION enforce_order_conflict_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_branch UUID; old_branch UUID; table_branch UUID; selected_table UUID;
BEGIN
  SELECT "branch_id", "table_id" INTO new_branch, selected_table FROM "orders" WHERE "id" = NEW."order_id";
  SELECT "branch_id" INTO old_branch FROM "orders" WHERE "id" = NEW."conflicting_order_id";
  SELECT "branch_id" INTO table_branch FROM "dining_tables" WHERE "id" = NEW."table_id";
  IF new_branch IS NULL OR new_branch <> old_branch OR new_branch <> table_branch OR selected_table <> NEW."table_id" THEN
    RAISE EXCEPTION 'order table conflict scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_conflicts_scope_guard BEFORE INSERT ON "order_table_conflicts" FOR EACH ROW EXECUTE FUNCTION enforce_order_conflict_scope();
CREATE FUNCTION enforce_order_line_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' AND
     (to_jsonb(NEW) - 'net_amount_minor' - 'tax_total_minor' - 'gross_amount_minor') IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'net_amount_minor' - 'tax_total_minor' - 'gross_amount_minor') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'DRAFT' OR NEW."status" NOT IN ('REPLACED','REMOVED') OR NEW."ended_at" IS NULL THEN
    RAISE EXCEPTION 'invalid order line lifecycle transition' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'ended_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'ended_at') THEN
    RAISE EXCEPTION 'order line snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_lines_immutable_guard BEFORE UPDATE ON "order_lines" FOR EACH ROW EXECUTE FUNCTION enforce_order_line_update();

CREATE FUNCTION enforce_tax_allocation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'taxable_base_minor' - 'amount_minor' - 'rounding_adjustment_minor') IS DISTINCT FROM
     (to_jsonb(OLD) - 'taxable_base_minor' - 'amount_minor' - 'rounding_adjustment_minor') THEN
    RAISE EXCEPTION 'tax component snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only order record' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON "order_events" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_line_modifiers_immutable BEFORE UPDATE OR DELETE ON "order_line_modifiers" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_line_taxes_snapshot_guard BEFORE UPDATE ON "order_line_tax_components" FOR EACH ROW EXECUTE FUNCTION enforce_tax_allocation_update();
CREATE TRIGGER order_line_taxes_no_delete BEFORE DELETE ON "order_line_tax_components" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_conflicts_append_only BEFORE UPDATE OR DELETE ON "order_table_conflicts" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER orders_no_delete BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER order_lines_no_delete BEFORE DELETE ON "order_lines" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
