ALTER TYPE "StockLedgerType" ADD VALUE 'PRODUCTION_INPUT';
ALTER TYPE "StockLedgerType" ADD VALUE 'PRODUCTION_OUTPUT';
CREATE TYPE "ModifierInventoryEffectKind" AS ENUM ('ADD', 'REMOVE', 'REPLACE_ADD', 'REPLACE_REMOVE');

CREATE TABLE "modifier_recipe_effect_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "menu_modifier_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "affects_inventory" BOOLEAN NOT NULL,
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "activated_by_id" UUID,
  "activated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "modifier_recipe_effect_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "modifier_recipe_effect_values_check" CHECK ("version" > 0 AND "revision" > 0),
  CONSTRAINT "modifier_recipe_effect_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
  )
);

CREATE TABLE "modifier_recipe_effect_components" (
  "effect_version_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "kind" "ModifierInventoryEffectKind" NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  CONSTRAINT "modifier_recipe_effect_components_pkey" PRIMARY KEY ("effect_version_id", "inventory_item_id", "kind"),
  CONSTRAINT "modifier_recipe_effect_component_quantity_check" CHECK ("quantity_micros" > 0)
);

CREATE TABLE "inventory_consumption_modifier_effects" (
  "consumption_id" UUID NOT NULL,
  "order_line_modifier_id" UUID NOT NULL,
  "effect_version_id" UUID NOT NULL,
  "modifier_quantity" INTEGER NOT NULL,
  CONSTRAINT "inventory_consumption_modifier_effects_pkey" PRIMARY KEY ("consumption_id", "order_line_modifier_id"),
  CONSTRAINT "inventory_consumption_modifier_quantity_check" CHECK ("modifier_quantity" > 0)
);

CREATE TABLE "batch_recipe_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "output_inventory_item_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "yield_quantity_micros" BIGINT NOT NULL,
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "activated_by_id" UUID,
  "activated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "batch_recipe_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_recipe_values_check" CHECK ("version" > 0 AND "revision" > 0 AND "yield_quantity_micros" > 0),
  CONSTRAINT "batch_recipe_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
  )
);

CREATE TABLE "batch_recipe_components" (
  "batch_recipe_version_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  CONSTRAINT "batch_recipe_components_pkey" PRIMARY KEY ("batch_recipe_version_id", "inventory_item_id"),
  CONSTRAINT "batch_recipe_component_quantity_check" CHECK ("quantity_micros" > 0)
);

CREATE TABLE "batch_productions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "batch_recipe_version_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "output_inventory_item_id" UUID NOT NULL,
  "output_location_id" UUID NOT NULL,
  "output_quantity_micros" BIGINT NOT NULL,
  "output_ledger_entry_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "negative_stock_override" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(500) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_productions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_production_values_check" CHECK ("revision" > 0 AND "output_quantity_micros" > 0 AND length(btrim("reason")) >= 3)
);

CREATE TABLE "batch_production_inputs" (
  "id" UUID NOT NULL,
  "production_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  CONSTRAINT "batch_production_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_production_input_quantity_check" CHECK ("quantity_micros" > 0)
);

CREATE TABLE "batch_production_reversals" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "production_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_production_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_production_reversal_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "batch_production_reversal_entries" (
  "id" UUID NOT NULL,
  "reversal_id" UUID NOT NULL,
  "original_ledger_entry_id" UUID NOT NULL,
  "reversal_ledger_entry_id" UUID NOT NULL,
  CONSTRAINT "batch_production_reversal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modifier_recipe_effect_versions_branch_id_menu_modifier_id_version_key" ON "modifier_recipe_effect_versions"("branch_id", "menu_modifier_id", "version");
CREATE INDEX "modifier_recipe_effect_versions_branch_modifier_status_effective_idx" ON "modifier_recipe_effect_versions"("branch_id", "menu_modifier_id", "status", "effective_from");
CREATE INDEX "modifier_recipe_effect_versions_created_by_id_idx" ON "modifier_recipe_effect_versions"("created_by_id");
CREATE INDEX "modifier_recipe_effect_versions_activated_by_id_idx" ON "modifier_recipe_effect_versions"("activated_by_id");
CREATE UNIQUE INDEX "modifier_recipe_effect_active_effective_key" ON "modifier_recipe_effect_versions"("branch_id", "menu_modifier_id", "effective_from") WHERE "status" = 'ACTIVE';
CREATE INDEX "modifier_recipe_effect_components_inventory_item_id_idx" ON "modifier_recipe_effect_components"("inventory_item_id");
CREATE INDEX "inventory_consumption_modifier_effects_order_line_modifier_id_idx" ON "inventory_consumption_modifier_effects"("order_line_modifier_id");
CREATE INDEX "inventory_consumption_modifier_effects_effect_version_id_idx" ON "inventory_consumption_modifier_effects"("effect_version_id");

CREATE UNIQUE INDEX "batch_recipe_versions_branch_id_output_inventory_item_id_version_key" ON "batch_recipe_versions"("branch_id", "output_inventory_item_id", "version");
CREATE INDEX "batch_recipe_versions_branch_output_status_effective_idx" ON "batch_recipe_versions"("branch_id", "output_inventory_item_id", "status", "effective_from");
CREATE INDEX "batch_recipe_versions_created_by_id_idx" ON "batch_recipe_versions"("created_by_id");
CREATE INDEX "batch_recipe_versions_activated_by_id_idx" ON "batch_recipe_versions"("activated_by_id");
CREATE UNIQUE INDEX "batch_recipe_active_effective_key" ON "batch_recipe_versions"("branch_id", "output_inventory_item_id", "effective_from") WHERE "status" = 'ACTIVE';
CREATE INDEX "batch_recipe_components_inventory_item_id_idx" ON "batch_recipe_components"("inventory_item_id");

CREATE UNIQUE INDEX "batch_productions_output_ledger_entry_id_key" ON "batch_productions"("output_ledger_entry_id");
CREATE INDEX "batch_productions_branch_id_occurred_at_idx" ON "batch_productions"("branch_id", "occurred_at");
CREATE INDEX "batch_productions_batch_recipe_version_id_idx" ON "batch_productions"("batch_recipe_version_id");
CREATE INDEX "batch_productions_actor_id_idx" ON "batch_productions"("actor_id");
CREATE INDEX "batch_productions_device_id_idx" ON "batch_productions"("device_id");
CREATE INDEX "batch_productions_output_inventory_item_id_idx" ON "batch_productions"("output_inventory_item_id");
CREATE INDEX "batch_productions_output_location_id_idx" ON "batch_productions"("output_location_id");
CREATE UNIQUE INDEX "batch_production_inputs_ledger_entry_id_key" ON "batch_production_inputs"("ledger_entry_id");
CREATE UNIQUE INDEX "batch_production_inputs_production_id_inventory_item_id_key" ON "batch_production_inputs"("production_id", "inventory_item_id");
CREATE INDEX "batch_production_inputs_inventory_item_id_idx" ON "batch_production_inputs"("inventory_item_id");
CREATE INDEX "batch_production_inputs_location_id_idx" ON "batch_production_inputs"("location_id");
CREATE UNIQUE INDEX "batch_production_reversals_production_id_key" ON "batch_production_reversals"("production_id");
CREATE INDEX "batch_production_reversals_branch_id_created_at_idx" ON "batch_production_reversals"("branch_id", "created_at");
CREATE INDEX "batch_production_reversals_actor_id_idx" ON "batch_production_reversals"("actor_id");
CREATE INDEX "batch_production_reversals_device_id_idx" ON "batch_production_reversals"("device_id");
CREATE UNIQUE INDEX "batch_production_reversal_entries_original_ledger_entry_id_key" ON "batch_production_reversal_entries"("original_ledger_entry_id");
CREATE UNIQUE INDEX "batch_production_reversal_entries_reversal_ledger_entry_id_key" ON "batch_production_reversal_entries"("reversal_ledger_entry_id");
CREATE INDEX "batch_production_reversal_entries_reversal_id_idx" ON "batch_production_reversal_entries"("reversal_id");

ALTER TABLE "modifier_recipe_effect_versions" ADD CONSTRAINT "modifier_recipe_effect_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_recipe_effect_versions" ADD CONSTRAINT "modifier_recipe_effect_modifier_fkey" FOREIGN KEY ("menu_modifier_id") REFERENCES "menu_modifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_recipe_effect_versions" ADD CONSTRAINT "modifier_recipe_effect_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_recipe_effect_versions" ADD CONSTRAINT "modifier_recipe_effect_activated_by_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_recipe_effect_components" ADD CONSTRAINT "modifier_recipe_effect_component_version_fkey" FOREIGN KEY ("effect_version_id") REFERENCES "modifier_recipe_effect_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_recipe_effect_components" ADD CONSTRAINT "modifier_recipe_effect_component_item_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_modifier_effects" ADD CONSTRAINT "inventory_consumption_modifier_effect_consumption_fkey" FOREIGN KEY ("consumption_id") REFERENCES "inventory_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_modifier_effects" ADD CONSTRAINT "inventory_consumption_modifier_effect_line_modifier_fkey" FOREIGN KEY ("order_line_modifier_id") REFERENCES "order_line_modifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumption_modifier_effects" ADD CONSTRAINT "inventory_consumption_modifier_effect_version_fkey" FOREIGN KEY ("effect_version_id") REFERENCES "modifier_recipe_effect_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batch_recipe_versions" ADD CONSTRAINT "batch_recipe_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_recipe_versions" ADD CONSTRAINT "batch_recipe_output_item_fkey" FOREIGN KEY ("branch_id", "output_inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_recipe_versions" ADD CONSTRAINT "batch_recipe_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_recipe_versions" ADD CONSTRAINT "batch_recipe_activated_by_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_recipe_components" ADD CONSTRAINT "batch_recipe_component_version_fkey" FOREIGN KEY ("batch_recipe_version_id") REFERENCES "batch_recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_recipe_components" ADD CONSTRAINT "batch_recipe_component_item_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_recipe_fkey" FOREIGN KEY ("batch_recipe_version_id") REFERENCES "batch_recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_device_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_output_item_fkey" FOREIGN KEY ("branch_id", "output_inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_output_location_fkey" FOREIGN KEY ("branch_id", "output_location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_productions" ADD CONSTRAINT "batch_production_output_ledger_fkey" FOREIGN KEY ("output_ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_inputs" ADD CONSTRAINT "batch_production_input_production_fkey" FOREIGN KEY ("production_id") REFERENCES "batch_productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_inputs" ADD CONSTRAINT "batch_production_input_item_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_inputs" ADD CONSTRAINT "batch_production_input_location_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_inputs" ADD CONSTRAINT "batch_production_input_ledger_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversals" ADD CONSTRAINT "batch_production_reversal_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversals" ADD CONSTRAINT "batch_production_reversal_production_fkey" FOREIGN KEY ("production_id") REFERENCES "batch_productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversals" ADD CONSTRAINT "batch_production_reversal_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversals" ADD CONSTRAINT "batch_production_reversal_device_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversal_entries" ADD CONSTRAINT "batch_production_reversal_entry_reversal_fkey" FOREIGN KEY ("reversal_id") REFERENCES "batch_production_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversal_entries" ADD CONSTRAINT "batch_production_reversal_entry_original_ledger_fkey" FOREIGN KEY ("original_ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_production_reversal_entries" ADD CONSTRAINT "batch_production_reversal_entry_reversal_ledger_fkey" FOREIGN KEY ("reversal_ledger_entry_id") REFERENCES "stock_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_production_configuration_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'active production configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER modifier_recipe_effect_active_immutable BEFORE UPDATE OR DELETE ON "modifier_recipe_effect_versions" FOR EACH ROW EXECUTE FUNCTION prevent_production_configuration_mutation();
CREATE TRIGGER batch_recipe_active_immutable BEFORE UPDATE OR DELETE ON "batch_recipe_versions" FOR EACH ROW EXECUTE FUNCTION prevent_production_configuration_mutation();

CREATE FUNCTION prevent_production_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'production history is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER modifier_recipe_effect_components_immutable BEFORE UPDATE OR DELETE ON "modifier_recipe_effect_components" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();
CREATE TRIGGER inventory_consumption_modifier_effects_immutable BEFORE UPDATE OR DELETE ON "inventory_consumption_modifier_effects" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();
CREATE TRIGGER batch_recipe_components_immutable BEFORE UPDATE OR DELETE ON "batch_recipe_components" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();
CREATE TRIGGER batch_production_inputs_immutable BEFORE UPDATE OR DELETE ON "batch_production_inputs" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();
CREATE TRIGGER batch_production_reversals_immutable BEFORE UPDATE OR DELETE ON "batch_production_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();
CREATE TRIGGER batch_production_reversal_entries_immutable BEFORE UPDATE OR DELETE ON "batch_production_reversal_entries" FOR EACH ROW EXECUTE FUNCTION prevent_production_history_mutation();

CREATE FUNCTION enforce_batch_production_revision_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) - 'revision' <> to_jsonb(OLD) - 'revision' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'batch production is append-only except revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_production_revision_guard BEFORE UPDATE OR DELETE ON "batch_productions" FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_revision_only();

CREATE FUNCTION enforce_production_configuration_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND organization_id = branch_org) OR
     (NEW.activated_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.activated_by_id AND organization_id = branch_org)) THEN
    RAISE EXCEPTION 'production configuration actor scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'modifier_recipe_effect_versions' AND NOT EXISTS (
    SELECT 1 FROM menu_modifiers m JOIN modifier_groups g ON g.id = m.group_id WHERE m.id = NEW.menu_modifier_id AND g.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'modifier recipe effect branch mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER modifier_recipe_effect_scope_guard BEFORE INSERT OR UPDATE ON "modifier_recipe_effect_versions" FOR EACH ROW EXECUTE FUNCTION enforce_production_configuration_scope();
CREATE TRIGGER batch_recipe_scope_guard BEFORE INSERT OR UPDATE ON "batch_recipe_versions" FOR EACH ROW EXECUTE FUNCTION enforce_production_configuration_scope();

CREATE FUNCTION enforce_modifier_recipe_effect_shape() RETURNS trigger AS $$
DECLARE component_count INTEGER;
BEGIN
  SELECT count(*) INTO component_count FROM modifier_recipe_effect_components WHERE effect_version_id = NEW.id;
  IF (NEW.affects_inventory AND component_count = 0) OR (NOT NEW.affects_inventory AND component_count <> 0) THEN
    RAISE EXCEPTION 'modifier inventory effect declaration does not match components' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM modifier_recipe_effect_components c
    JOIN inventory_items i ON i.id = c.inventory_item_id
    WHERE c.effect_version_id = NEW.id AND i.branch_id <> NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'modifier inventory effect item branch mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER modifier_recipe_effect_shape_guard AFTER INSERT OR UPDATE ON "modifier_recipe_effect_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_modifier_recipe_effect_shape();

CREATE FUNCTION enforce_modifier_recipe_effect_component_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM modifier_recipe_effect_versions e
    JOIN inventory_items i ON i.id = NEW.inventory_item_id
    WHERE e.id = NEW.effect_version_id AND e.affects_inventory AND i.branch_id = e.branch_id
  ) THEN
    RAISE EXCEPTION 'modifier inventory effect component scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER modifier_recipe_effect_component_scope_guard BEFORE INSERT ON "modifier_recipe_effect_components" FOR EACH ROW EXECUTE FUNCTION enforce_modifier_recipe_effect_component_scope();

CREATE FUNCTION enforce_consumption_modifier_effect_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM inventory_consumptions c
    JOIN order_line_modifiers olm ON olm.id = NEW.order_line_modifier_id AND olm.order_line_id = c.order_line_id AND olm.quantity = NEW.modifier_quantity
    JOIN modifier_recipe_effect_versions e ON e.id = NEW.effect_version_id AND e.branch_id = c.branch_id AND e.menu_modifier_id = olm.menu_modifier_id AND e.status = 'ACTIVE' AND e.effective_from <= c.occurred_at
    WHERE c.id = NEW.consumption_id
  ) THEN
    RAISE EXCEPTION 'consumption modifier effect scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_consumption_modifier_effect_scope_guard BEFORE INSERT ON "inventory_consumption_modifier_effects" FOR EACH ROW EXECUTE FUNCTION enforce_consumption_modifier_effect_scope();

CREATE FUNCTION enforce_batch_recipe_component_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM batch_recipe_versions r JOIN inventory_items i ON i.id = NEW.inventory_item_id
    WHERE r.id = NEW.batch_recipe_version_id AND i.branch_id = r.branch_id AND i.id <> r.output_inventory_item_id
  ) THEN
    RAISE EXCEPTION 'batch recipe input scope or self-reference mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_recipe_component_scope_guard BEFORE INSERT ON "batch_recipe_components" FOR EACH ROW EXECUTE FUNCTION enforce_batch_recipe_component_scope();

CREATE FUNCTION enforce_batch_recipe_shape() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM batch_recipe_components WHERE batch_recipe_version_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'active batch recipe requires inputs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER batch_recipe_shape_guard AFTER INSERT OR UPDATE ON "batch_recipe_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_batch_recipe_shape();

CREATE FUNCTION enforce_batch_production_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (
    SELECT 1 FROM batch_recipe_versions r WHERE r.id = NEW.batch_recipe_version_id AND r.branch_id = NEW.branch_id
      AND r.output_inventory_item_id = NEW.output_inventory_item_id AND r.status = 'ACTIVE' AND r.effective_from <= NEW.occurred_at
  ) OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) OR
     NOT EXISTS (
       SELECT 1 FROM stock_ledger_entries l WHERE l.id = NEW.output_ledger_entry_id AND l.branch_id = NEW.branch_id
         AND l.location_id = NEW.output_location_id AND l.inventory_item_id = NEW.output_inventory_item_id
         AND l.type = 'PRODUCTION_OUTPUT' AND l.quantity_delta_micros = NEW.output_quantity_micros
         AND l.source_type = 'BATCH_PRODUCTION' AND l.source_id = NEW.id AND l.occurred_at = NEW.occurred_at
     ) THEN
    RAISE EXCEPTION 'batch production scope or output ledger mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_production_scope_guard BEFORE INSERT ON "batch_productions" FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_scope();

CREATE FUNCTION enforce_batch_production_input() RETURNS trigger AS $$
DECLARE parent_branch UUID; DECLARE parent_recipe UUID; DECLARE parent_output UUID; DECLARE parent_override BOOLEAN; DECLARE parent_occurred TIMESTAMPTZ(3);
BEGIN
  SELECT branch_id, batch_recipe_version_id, output_inventory_item_id, negative_stock_override, occurred_at
    INTO parent_branch, parent_recipe, parent_output, parent_override, parent_occurred FROM batch_productions WHERE id = NEW.production_id;
  IF NEW.inventory_item_id = parent_output OR NOT EXISTS (
    SELECT 1 FROM batch_recipe_components c JOIN batch_recipe_versions r ON r.id = c.batch_recipe_version_id
    JOIN batch_productions p ON p.id = NEW.production_id
    WHERE c.batch_recipe_version_id = parent_recipe AND c.inventory_item_id = NEW.inventory_item_id
      AND NEW.quantity_micros::numeric * r.yield_quantity_micros::numeric = c.quantity_micros::numeric * p.output_quantity_micros::numeric
  ) OR NOT EXISTS (
    SELECT 1 FROM inventory_items i WHERE i.id = NEW.inventory_item_id AND i.branch_id = parent_branch
  ) OR NOT EXISTS (
    SELECT 1 FROM stock_locations s WHERE s.id = NEW.location_id AND s.branch_id = parent_branch
  ) OR NOT EXISTS (
    SELECT 1 FROM stock_ledger_entries l WHERE l.id = NEW.ledger_entry_id AND l.branch_id = parent_branch
      AND l.inventory_item_id = NEW.inventory_item_id AND l.location_id = NEW.location_id
      AND l.type = 'PRODUCTION_INPUT' AND l.quantity_delta_micros = -NEW.quantity_micros
      AND l.source_type = 'BATCH_PRODUCTION' AND l.source_id = NEW.production_id
      AND l.occurred_at = parent_occurred AND l.negative_stock_override = parent_override
  ) THEN
    RAISE EXCEPTION 'batch production input or ledger mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_production_input_guard BEFORE INSERT ON "batch_production_inputs" FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_input();

CREATE FUNCTION enforce_batch_production_reconciliation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT c.inventory_item_id FROM batch_recipe_components c WHERE c.batch_recipe_version_id = NEW.batch_recipe_version_id
    EXCEPT
    SELECT i.inventory_item_id FROM batch_production_inputs i WHERE i.production_id = NEW.id
  ) OR EXISTS (
    SELECT i.inventory_item_id FROM batch_production_inputs i WHERE i.production_id = NEW.id
    EXCEPT
    SELECT c.inventory_item_id FROM batch_recipe_components c WHERE c.batch_recipe_version_id = NEW.batch_recipe_version_id
  ) THEN
    RAISE EXCEPTION 'batch production inputs do not reconcile to recipe' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER batch_production_reconciliation_guard AFTER INSERT ON "batch_productions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_reconciliation();

CREATE FUNCTION enforce_batch_production_reversal_scope() RETURNS trigger AS $$
DECLARE parent_branch UUID; DECLARE branch_org UUID;
BEGIN
  SELECT branch_id INTO parent_branch FROM batch_productions WHERE id = NEW.production_id;
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF parent_branch IS DISTINCT FROM NEW.branch_id OR
     NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'batch production reversal scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_production_reversal_scope_guard BEFORE INSERT ON "batch_production_reversals" FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_reversal_scope();

CREATE FUNCTION enforce_batch_production_reversal_entry() RETURNS trigger AS $$
DECLARE expected_branch UUID; DECLARE original_item UUID; DECLARE original_location UUID; DECLARE original_quantity BIGINT;
BEGIN
  SELECT r.branch_id, o.inventory_item_id, o.location_id, o.quantity_delta_micros
    INTO expected_branch, original_item, original_location, original_quantity
  FROM batch_production_reversals r
  JOIN batch_productions p ON p.id = r.production_id
  JOIN stock_ledger_entries o ON o.id = NEW.original_ledger_entry_id AND o.source_type = 'BATCH_PRODUCTION' AND o.source_id = p.id
  WHERE r.id = NEW.reversal_id;
  IF expected_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM stock_ledger_entries l WHERE l.id = NEW.reversal_ledger_entry_id AND l.branch_id = expected_branch
      AND l.inventory_item_id = original_item AND l.location_id = original_location
      AND l.type = 'REVERSAL' AND l.quantity_delta_micros = -original_quantity
      AND l.source_type = 'BATCH_PRODUCTION_REVERSAL' AND l.source_id = NEW.reversal_id
  ) THEN
    RAISE EXCEPTION 'batch production reversal ledger mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batch_production_reversal_entry_guard BEFORE INSERT ON "batch_production_reversal_entries" FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_reversal_entry();

CREATE FUNCTION enforce_batch_production_reversal_complete() RETURNS trigger AS $$
DECLARE expected_count INTEGER; DECLARE actual_count INTEGER;
BEGIN
  SELECT 1 + count(i.id) INTO expected_count
  FROM batch_productions p LEFT JOIN batch_production_inputs i ON i.production_id = p.id
  WHERE p.id = NEW.production_id GROUP BY p.id;
  SELECT count(*) INTO actual_count FROM batch_production_reversal_entries WHERE reversal_id = NEW.id;
  IF actual_count <> expected_count OR EXISTS (
    SELECT p.output_ledger_entry_id FROM batch_productions p WHERE p.id = NEW.production_id
    UNION ALL
    SELECT i.ledger_entry_id FROM batch_production_inputs i WHERE i.production_id = NEW.production_id
    EXCEPT
    SELECT e.original_ledger_entry_id FROM batch_production_reversal_entries e WHERE e.reversal_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'batch production reversal is incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER batch_production_reversal_complete_guard AFTER INSERT ON "batch_production_reversals" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_batch_production_reversal_complete();
