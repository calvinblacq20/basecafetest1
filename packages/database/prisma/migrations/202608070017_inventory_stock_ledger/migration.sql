CREATE TYPE "InventoryUnitDimension" AS ENUM ('MASS', 'VOLUME', 'COUNT');
CREATE TYPE "InventoryLocationKind" AS ENUM ('STORE', 'KITCHEN', 'BAR', 'OTHER');
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');
CREATE TYPE "StockLedgerType" AS ENUM ('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'WASTE', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUSTMENT', 'SALE_CONSUMPTION', 'REVERSAL');
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "inventory_units" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "dimension" "InventoryUnitDimension" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_units_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "inventory_unit_conversions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "from_unit_id" UUID NOT NULL,
  "to_unit_id" UUID NOT NULL,
  "numerator" BIGINT NOT NULL,
  "denominator" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_unit_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_unit_conversion_positive_check" CHECK ("numerator" > 0 AND "denominator" > 0),
  CONSTRAINT "inventory_unit_conversion_distinct_check" CHECK ("from_unit_id" <> "to_unit_id")
);

CREATE TABLE "stock_locations" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "external_key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "kind" "InventoryLocationKind" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_locations_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "inventory_items" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "base_unit_id" UUID NOT NULL,
  "external_key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "recipe_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "menu_item_id" UUID NOT NULL,
  "menu_variant_id" UUID,
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
  CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipe_version_values_check" CHECK ("version" > 0 AND "revision" > 0 AND "yield_quantity_micros" > 0),
  CONSTRAINT "recipe_version_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED')
  )
);

CREATE TABLE "recipe_components" (
  "recipe_version_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("recipe_version_id", "inventory_item_id"),
  CONSTRAINT "recipe_component_quantity_check" CHECK ("quantity_micros" > 0)
);

CREATE TABLE "stock_ledger_entries" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "type" "StockLedgerType" NOT NULL,
  "quantity_delta_micros" BIGINT NOT NULL,
  "source_type" VARCHAR(80) NOT NULL,
  "source_id" UUID NOT NULL,
  "negative_stock_override" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(500) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_ledger_nonzero_check" CHECK ("quantity_delta_micros" <> 0),
  CONSTRAINT "stock_ledger_waste_direction_check" CHECK ("type" <> 'WASTE' OR "quantity_delta_micros" < 0),
  CONSTRAINT "stock_ledger_transfer_direction_check" CHECK (("type" <> 'TRANSFER_OUT' OR "quantity_delta_micros" < 0) AND ("type" <> 'TRANSFER_IN' OR "quantity_delta_micros" > 0)),
  CONSTRAINT "stock_ledger_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "inventory_transfers" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "from_location_id" UUID NOT NULL,
  "to_location_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "quantity_micros" BIGINT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transfer_values_check" CHECK ("quantity_micros" > 0 AND "from_location_id" <> "to_location_id"),
  CONSTRAINT "inventory_transfer_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "stock_counts" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "posted_by_id" UUID,
  "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reason" VARCHAR(500) NOT NULL,
  "posted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_values_check" CHECK ("revision" > 0 AND length(btrim("reason")) >= 3),
  CONSTRAINT "stock_count_lifecycle_check" CHECK (("status" = 'DRAFT' AND "posted_by_id" IS NULL AND "posted_at" IS NULL) OR ("status" = 'POSTED' AND "posted_by_id" IS NOT NULL AND "posted_at" IS NOT NULL) OR "status" = 'CANCELLED')
);

CREATE TABLE "stock_count_lines" (
  "stock_count_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "counted_quantity_micros" BIGINT NOT NULL,
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("stock_count_id", "inventory_item_id"),
  CONSTRAINT "stock_count_line_nonnegative_check" CHECK ("counted_quantity_micros" >= 0)
);

CREATE UNIQUE INDEX "inventory_units_organization_id_code_key" ON "inventory_units"("organization_id", "code");
CREATE UNIQUE INDEX "inventory_units_organization_id_name_key" ON "inventory_units"("organization_id", "name");
CREATE UNIQUE INDEX "inventory_unit_conversions_org_units_key" ON "inventory_unit_conversions"("organization_id", "from_unit_id", "to_unit_id");
CREATE UNIQUE INDEX "stock_locations_branch_id_external_key_key" ON "stock_locations"("branch_id", "external_key");
CREATE UNIQUE INDEX "stock_locations_branch_id_name_key" ON "stock_locations"("branch_id", "name");
CREATE UNIQUE INDEX "stock_locations_branch_id_id_key" ON "stock_locations"("branch_id", "id");
CREATE INDEX "stock_locations_branch_id_is_active_idx" ON "stock_locations"("branch_id", "is_active");
CREATE UNIQUE INDEX "inventory_items_branch_id_external_key_key" ON "inventory_items"("branch_id", "external_key");
CREATE UNIQUE INDEX "inventory_items_branch_id_name_key" ON "inventory_items"("branch_id", "name");
CREATE UNIQUE INDEX "inventory_items_branch_id_id_key" ON "inventory_items"("branch_id", "id");
CREATE INDEX "inventory_items_branch_id_is_active_idx" ON "inventory_items"("branch_id", "is_active");
CREATE UNIQUE INDEX "recipe_versions_branch_item_variant_version_key" ON "recipe_versions"("branch_id", "menu_item_id", "menu_variant_id", "version");
CREATE INDEX "recipe_versions_resolution_idx" ON "recipe_versions"("branch_id", "menu_item_id", "menu_variant_id", "status", "effective_from");
CREATE UNIQUE INDEX "stock_ledger_source_key" ON "stock_ledger_entries"("source_type", "source_id", "type", "location_id", "inventory_item_id");
CREATE INDEX "stock_ledger_balance_idx" ON "stock_ledger_entries"("branch_id", "location_id", "inventory_item_id", "occurred_at");
CREATE INDEX "stock_ledger_type_idx" ON "stock_ledger_entries"("branch_id", "type", "occurred_at");
CREATE INDEX "inventory_transfers_branch_created_idx" ON "inventory_transfers"("branch_id", "created_at");
CREATE INDEX "stock_counts_branch_status_created_idx" ON "stock_counts"("branch_id", "status", "created_at");

ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_unit_conversions" ADD CONSTRAINT "inventory_unit_conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_unit_conversions" ADD CONSTRAINT "inventory_unit_conversions_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_unit_conversions" ADD CONSTRAINT "inventory_unit_conversions_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_menu_variant_id_fkey" FOREIGN KEY ("menu_variant_id") REFERENCES "menu_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_location_fkey" FOREIGN KEY ("branch_id", "location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_location_fkey" FOREIGN KEY ("branch_id", "from_location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_location_fkey" FOREIGN KEY ("branch_id", "to_location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_location_fkey" FOREIGN KEY ("branch_id", "location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_stock_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock ledger entries are append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON "stock_ledger_entries" FOR EACH ROW EXECUTE FUNCTION prevent_stock_ledger_mutation();

CREATE FUNCTION enforce_inventory_tenant_consistency() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  IF TG_TABLE_NAME = 'inventory_unit_conversions' THEN
    IF EXISTS (SELECT 1 FROM inventory_units WHERE id IN (NEW.from_unit_id, NEW.to_unit_id) AND organization_id <> NEW.organization_id) THEN
      RAISE EXCEPTION 'inventory conversion organization mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_items' THEN
    SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
    IF NOT EXISTS (SELECT 1 FROM inventory_units WHERE id = NEW.base_unit_id AND organization_id = branch_org) THEN
      RAISE EXCEPTION 'inventory item unit organization mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'recipe_versions' THEN
    IF NOT EXISTS (SELECT 1 FROM menu_items WHERE id = NEW.menu_item_id AND branch_id = NEW.branch_id) OR
       (NEW.menu_variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_variants v JOIN menu_items i ON i.id = v.menu_item_id WHERE v.id = NEW.menu_variant_id AND i.id = NEW.menu_item_id AND i.branch_id = NEW.branch_id)) THEN
      RAISE EXCEPTION 'recipe catalog branch mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_conversion_tenant_guard BEFORE INSERT OR UPDATE ON "inventory_unit_conversions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_tenant_consistency();
CREATE TRIGGER inventory_item_tenant_guard BEFORE INSERT OR UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_tenant_consistency();
CREATE TRIGGER recipe_version_tenant_guard BEFORE INSERT OR UPDATE ON "recipe_versions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_tenant_consistency();

CREATE FUNCTION enforce_inventory_history() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'recipe_versions' AND OLD.status = 'ACTIVE' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'active recipe versions are immutable' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'recipe_components' AND EXISTS (SELECT 1 FROM recipe_versions WHERE id = OLD.recipe_version_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'active recipe components are immutable' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'stock_counts' AND OLD.status <> 'DRAFT' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'posted or cancelled stock counts are immutable' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'stock_count_lines' AND EXISTS (SELECT 1 FROM stock_counts WHERE id = OLD.stock_count_id AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'posted stock count lines are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER active_recipe_immutable BEFORE UPDATE OR DELETE ON "recipe_versions" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_history();
CREATE TRIGGER active_recipe_components_immutable BEFORE UPDATE OR DELETE ON "recipe_components" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_history();
CREATE TRIGGER posted_stock_count_immutable BEFORE UPDATE OR DELETE ON "stock_counts" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_history();
CREATE TRIGGER posted_stock_count_lines_immutable BEFORE UPDATE OR DELETE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_history();

CREATE FUNCTION enforce_inventory_child_branch() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'recipe_components' AND NOT EXISTS (
    SELECT 1 FROM recipe_versions r JOIN inventory_items i ON i.id = NEW.inventory_item_id
    WHERE r.id = NEW.recipe_version_id AND r.branch_id = i.branch_id
  ) THEN RAISE EXCEPTION 'recipe component branch mismatch' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'stock_count_lines' AND NOT EXISTS (
    SELECT 1 FROM stock_counts c JOIN inventory_items i ON i.id = NEW.inventory_item_id
    WHERE c.id = NEW.stock_count_id AND c.branch_id = i.branch_id
  ) THEN RAISE EXCEPTION 'stock count line branch mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER recipe_component_branch_guard BEFORE INSERT OR UPDATE ON "recipe_components" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_child_branch();
CREATE TRIGGER stock_count_line_branch_guard BEFORE INSERT OR UPDATE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_child_branch();
