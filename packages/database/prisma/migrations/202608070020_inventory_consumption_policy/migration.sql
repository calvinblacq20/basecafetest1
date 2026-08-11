CREATE TYPE "InventoryDeductionTrigger" AS ENUM ('SENT', 'PREPARED', 'SERVED', 'COMPLETED');
CREATE TYPE "InventoryPolicyStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ACTIVE', 'CANCELLED');

CREATE TABLE "inventory_deduction_policy_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "trigger" "InventoryDeductionTrigger" NOT NULL,
  "status" "InventoryPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "evidence_reference" VARCHAR(240),
  "created_by_id" UUID NOT NULL,
  "confirmed_by_id" UUID,
  "activated_by_id" UUID,
  "confirmed_at" TIMESTAMPTZ(3),
  "activated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_deduction_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_deduction_policy_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "inventory_deduction_policy_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "evidence_reference" IS NULL AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'CONFIRMED' AND length(btrim("evidence_reference")) >= 3 AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND length(btrim("evidence_reference")) >= 3 AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
  )
);

CREATE TABLE "inventory_consumption_route_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "station_id" UUID,
  "location_id" UUID NOT NULL,
  "status" "InventoryPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "activated_by_id" UUID,
  "activated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_consumption_route_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_consumption_route_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "inventory_consumption_route_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
  )
);

CREATE TABLE "inventory_consumptions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_line_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "recipe_version_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "source_event_id" UUID NOT NULL,
  "trigger" "InventoryDeductionTrigger" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "order_line_quantity" INTEGER NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "negative_stock_override" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_consumption_values_check" CHECK (
    "revision" > 0 AND "order_line_quantity" > 0 AND length(btrim("reason")) >= 3
  )
);

CREATE TABLE "inventory_consumption_entries" (
  "id" UUID NOT NULL,
  "consumption_id" UUID NOT NULL,
  "route_version_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  CONSTRAINT "inventory_consumption_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_consumption_entry_quantity_check" CHECK ("quantity_micros" > 0)
);

CREATE TABLE "inventory_consumption_reversals" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "consumption_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_consumption_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_consumption_reversal_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "inventory_consumption_reversal_entries" (
  "id" UUID NOT NULL,
  "reversal_id" UUID NOT NULL,
  "consumption_entry_id" UUID NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  CONSTRAINT "inventory_consumption_reversal_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_deduction_policy_versions_branch_id_status_effective_from_idx" ON "inventory_deduction_policy_versions"("branch_id", "status", "effective_from");
CREATE INDEX "inventory_deduction_policy_versions_created_by_id_idx" ON "inventory_deduction_policy_versions"("created_by_id");
CREATE INDEX "inventory_deduction_policy_versions_confirmed_by_id_idx" ON "inventory_deduction_policy_versions"("confirmed_by_id");
CREATE INDEX "inventory_deduction_policy_versions_activated_by_id_idx" ON "inventory_deduction_policy_versions"("activated_by_id");
CREATE UNIQUE INDEX "inventory_deduction_policy_active_effective_key" ON "inventory_deduction_policy_versions"("branch_id", "effective_from") WHERE "status" = 'ACTIVE';

CREATE INDEX "inventory_consumption_route_versions_branch_item_station_status_effective_idx" ON "inventory_consumption_route_versions"("branch_id", "inventory_item_id", "station_id", "status", "effective_from");
CREATE INDEX "inventory_consumption_route_versions_location_id_idx" ON "inventory_consumption_route_versions"("location_id");
CREATE INDEX "inventory_consumption_route_versions_station_id_idx" ON "inventory_consumption_route_versions"("station_id");
CREATE INDEX "inventory_consumption_route_versions_created_by_id_idx" ON "inventory_consumption_route_versions"("created_by_id");
CREATE INDEX "inventory_consumption_route_versions_activated_by_id_idx" ON "inventory_consumption_route_versions"("activated_by_id");
CREATE UNIQUE INDEX "inventory_consumption_route_active_effective_key" ON "inventory_consumption_route_versions"("branch_id", "inventory_item_id", "station_id", "effective_from") NULLS NOT DISTINCT WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "inventory_consumptions_order_line_id_key" ON "inventory_consumptions"("order_line_id");
CREATE INDEX "inventory_consumptions_branch_id_occurred_at_idx" ON "inventory_consumptions"("branch_id", "occurred_at");
CREATE INDEX "inventory_consumptions_order_id_occurred_at_idx" ON "inventory_consumptions"("order_id", "occurred_at");
CREATE INDEX "inventory_consumptions_policy_version_id_idx" ON "inventory_consumptions"("policy_version_id");
CREATE INDEX "inventory_consumptions_recipe_version_id_idx" ON "inventory_consumptions"("recipe_version_id");
CREATE INDEX "inventory_consumptions_actor_id_idx" ON "inventory_consumptions"("actor_id");
CREATE INDEX "inventory_consumptions_device_id_idx" ON "inventory_consumptions"("device_id");
CREATE INDEX "inventory_consumptions_source_event_id_idx" ON "inventory_consumptions"("source_event_id");

CREATE UNIQUE INDEX "inventory_consumption_entries_ledger_entry_id_key" ON "inventory_consumption_entries"("ledger_entry_id");
CREATE UNIQUE INDEX "inventory_consumption_entries_consumption_item_location_key" ON "inventory_consumption_entries"("consumption_id", "inventory_item_id", "location_id");
CREATE INDEX "inventory_consumption_entries_route_version_id_idx" ON "inventory_consumption_entries"("route_version_id");
CREATE INDEX "inventory_consumption_entries_inventory_item_id_idx" ON "inventory_consumption_entries"("inventory_item_id");
CREATE INDEX "inventory_consumption_entries_location_id_idx" ON "inventory_consumption_entries"("location_id");

CREATE UNIQUE INDEX "inventory_consumption_reversals_consumption_id_key" ON "inventory_consumption_reversals"("consumption_id");
CREATE INDEX "inventory_consumption_reversals_branch_id_created_at_idx" ON "inventory_consumption_reversals"("branch_id", "created_at");
CREATE INDEX "inventory_consumption_reversals_actor_id_idx" ON "inventory_consumption_reversals"("actor_id");
CREATE INDEX "inventory_consumption_reversals_device_id_idx" ON "inventory_consumption_reversals"("device_id");
CREATE UNIQUE INDEX "inventory_consumption_reversal_entries_consumption_entry_id_key" ON "inventory_consumption_reversal_entries"("consumption_entry_id");
CREATE UNIQUE INDEX "inventory_consumption_reversal_entries_ledger_entry_id_key" ON "inventory_consumption_reversal_entries"("ledger_entry_id");
CREATE INDEX "inventory_consumption_reversal_entries_reversal_id_idx" ON "inventory_consumption_reversal_entries"("reversal_id");

ALTER TABLE "inventory_deduction_policy_versions" ADD CONSTRAINT "inventory_deduction_policy_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_deduction_policy_versions" ADD CONSTRAINT "inventory_deduction_policy_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_deduction_policy_versions" ADD CONSTRAINT "inventory_deduction_policy_confirmed_by_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_deduction_policy_versions" ADD CONSTRAINT "inventory_deduction_policy_activated_by_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_station_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_location_fkey" FOREIGN KEY ("branch_id", "location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_route_versions" ADD CONSTRAINT "inventory_consumption_route_activated_by_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_order_line_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_policy_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "inventory_deduction_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_recipe_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumption_device_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_consumption_entries" ADD CONSTRAINT "inventory_consumption_entry_consumption_fkey" FOREIGN KEY ("consumption_id") REFERENCES "inventory_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_entries" ADD CONSTRAINT "inventory_consumption_entry_route_fkey" FOREIGN KEY ("route_version_id") REFERENCES "inventory_consumption_route_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_entries" ADD CONSTRAINT "inventory_consumption_entry_item_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_entries" ADD CONSTRAINT "inventory_consumption_entry_location_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_entries" ADD CONSTRAINT "inventory_consumption_entry_ledger_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_consumption_reversals" ADD CONSTRAINT "inventory_consumption_reversal_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_reversals" ADD CONSTRAINT "inventory_consumption_reversal_consumption_fkey" FOREIGN KEY ("consumption_id") REFERENCES "inventory_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_reversals" ADD CONSTRAINT "inventory_consumption_reversal_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_reversals" ADD CONSTRAINT "inventory_consumption_reversal_device_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_consumption_reversal_entries" ADD CONSTRAINT "inventory_consumption_reversal_entry_reversal_fkey" FOREIGN KEY ("reversal_id") REFERENCES "inventory_consumption_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_reversal_entries" ADD CONSTRAINT "inventory_consumption_reversal_entry_consumption_entry_fkey" FOREIGN KEY ("consumption_entry_id") REFERENCES "inventory_consumption_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_reversal_entries" ADD CONSTRAINT "inventory_consumption_reversal_entry_ledger_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_active_inventory_consumption_configuration_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'active inventory consumption configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_deduction_policy_active_immutable BEFORE UPDATE OR DELETE ON "inventory_deduction_policy_versions" FOR EACH ROW EXECUTE FUNCTION prevent_active_inventory_consumption_configuration_mutation();
CREATE TRIGGER inventory_consumption_route_active_immutable BEFORE UPDATE OR DELETE ON "inventory_consumption_route_versions" FOR EACH ROW EXECUTE FUNCTION prevent_active_inventory_consumption_configuration_mutation();

CREATE FUNCTION prevent_inventory_consumption_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory consumption history is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_entries_immutable BEFORE UPDATE OR DELETE ON "inventory_consumption_entries" FOR EACH ROW EXECUTE FUNCTION prevent_inventory_consumption_history_mutation();
CREATE TRIGGER inventory_consumption_reversals_immutable BEFORE UPDATE OR DELETE ON "inventory_consumption_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_inventory_consumption_history_mutation();
CREATE TRIGGER inventory_consumption_reversal_entries_immutable BEFORE UPDATE OR DELETE ON "inventory_consumption_reversal_entries" FOR EACH ROW EXECUTE FUNCTION prevent_inventory_consumption_history_mutation();

CREATE FUNCTION enforce_inventory_consumption_revision_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) - 'revision' <> to_jsonb(OLD) - 'revision' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'inventory consumption is append-only except revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_revision_guard BEFORE UPDATE OR DELETE ON "inventory_consumptions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_revision_only();

CREATE FUNCTION enforce_inventory_consumption_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.order_id AND branch_id = NEW.branch_id) OR
     NOT EXISTS (SELECT 1 FROM order_lines WHERE id = NEW.order_line_id AND order_id = NEW.order_id AND quantity = NEW.order_line_quantity) OR
     NOT EXISTS (SELECT 1 FROM inventory_deduction_policy_versions WHERE id = NEW.policy_version_id AND branch_id = NEW.branch_id AND status = 'ACTIVE' AND trigger = NEW.trigger AND effective_from <= NEW.occurred_at) OR
     NOT EXISTS (SELECT 1 FROM recipe_versions WHERE id = NEW.recipe_version_id AND branch_id = NEW.branch_id AND status = 'ACTIVE' AND effective_from <= NEW.occurred_at) OR
     NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'inventory consumption scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_scope_guard BEFORE INSERT ON "inventory_consumptions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_scope();

CREATE FUNCTION enforce_inventory_consumption_entry_ledger() RETURNS trigger AS $$
DECLARE parent_branch UUID; DECLARE parent_occurred TIMESTAMPTZ(3); DECLARE parent_override BOOLEAN;
BEGIN
  SELECT branch_id, occurred_at, negative_stock_override INTO parent_branch, parent_occurred, parent_override FROM inventory_consumptions WHERE id = NEW.consumption_id;
  IF NOT EXISTS (
    SELECT 1 FROM inventory_consumption_route_versions
    WHERE id = NEW.route_version_id AND branch_id = parent_branch AND inventory_item_id = NEW.inventory_item_id AND location_id = NEW.location_id AND status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM stock_ledger_entries
    WHERE id = NEW.ledger_entry_id AND branch_id = parent_branch AND location_id = NEW.location_id AND inventory_item_id = NEW.inventory_item_id
      AND type = 'SALE_CONSUMPTION' AND quantity_delta_micros = -NEW.quantity_micros
      AND source_type = 'INVENTORY_CONSUMPTION' AND source_id = NEW.consumption_id
      AND occurred_at = parent_occurred AND negative_stock_override = parent_override
  ) THEN
    RAISE EXCEPTION 'inventory consumption entry or ledger mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_entry_ledger_guard BEFORE INSERT ON "inventory_consumption_entries" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_entry_ledger();

CREATE FUNCTION enforce_inventory_consumption_reversal_scope() RETURNS trigger AS $$
DECLARE parent_branch UUID; DECLARE branch_org UUID;
BEGIN
  SELECT branch_id INTO parent_branch FROM inventory_consumptions WHERE id = NEW.consumption_id;
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF parent_branch IS DISTINCT FROM NEW.branch_id OR
     NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'inventory consumption reversal scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_reversal_scope_guard BEFORE INSERT ON "inventory_consumption_reversals" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_reversal_scope();

CREATE FUNCTION enforce_inventory_consumption_reversal_ledger() RETURNS trigger AS $$
DECLARE expected_branch UUID; DECLARE expected_item UUID; DECLARE expected_location UUID; DECLARE expected_quantity BIGINT;
BEGIN
  SELECT r.branch_id, e.inventory_item_id, e.location_id, e.quantity_micros
  INTO expected_branch, expected_item, expected_location, expected_quantity
  FROM inventory_consumption_reversals r
  JOIN inventory_consumption_entries e ON e.id = NEW.consumption_entry_id
  WHERE r.id = NEW.reversal_id AND e.consumption_id = r.consumption_id;
  IF expected_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM stock_ledger_entries
    WHERE id = NEW.ledger_entry_id AND branch_id = expected_branch AND inventory_item_id = expected_item AND location_id = expected_location
      AND type = 'REVERSAL' AND quantity_delta_micros = expected_quantity
      AND source_type = 'INVENTORY_CONSUMPTION_REVERSAL' AND source_id = NEW.reversal_id
  ) THEN
    RAISE EXCEPTION 'inventory consumption reversal ledger mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_reversal_ledger_guard BEFORE INSERT ON "inventory_consumption_reversal_entries" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_reversal_ledger();

CREATE FUNCTION enforce_inventory_consumption_configuration_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF TG_TABLE_NAME = 'inventory_deduction_policy_versions' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND organization_id = branch_org) OR
       (NEW.confirmed_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.confirmed_by_id AND organization_id = branch_org)) OR
       (NEW.activated_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.activated_by_id AND organization_id = branch_org)) THEN
      RAISE EXCEPTION 'inventory deduction policy actor scope mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND organization_id = branch_org) OR
       (NEW.activated_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.activated_by_id AND organization_id = branch_org)) OR
       (NEW.station_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stations WHERE id = NEW.station_id AND branch_id = NEW.branch_id)) THEN
      RAISE EXCEPTION 'inventory consumption route scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_deduction_policy_scope_guard BEFORE INSERT OR UPDATE ON "inventory_deduction_policy_versions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_configuration_scope();
CREATE TRIGGER inventory_consumption_route_scope_guard BEFORE INSERT OR UPDATE ON "inventory_consumption_route_versions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_consumption_configuration_scope();
