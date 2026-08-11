CREATE TYPE "AvailabilityTargetKind" AS ENUM ('ITEM', 'VARIANT', 'MODIFIER');
CREATE TYPE "ManualAvailabilityState" AS ENUM ('UNAVAILABLE', 'RESTORED');

CREATE TABLE "critical_ingredient_rule_versions" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "menu_item_id" UUID NOT NULL,
  "menu_variant_id" UUID,
  "recipe_version_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
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
  CONSTRAINT "critical_ingredient_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "critical_ingredient_rule_values_check" CHECK ("version" > 0 AND "revision" > 0),
  CONSTRAINT "critical_ingredient_rule_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "evidence_reference" IS NULL AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'CONFIRMED' AND length(btrim("evidence_reference")) >= 3 AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL) OR
    ("status" = 'ACTIVE' AND length(btrim("evidence_reference")) >= 3 AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "evidence_reference" IS NULL AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
  )
);

CREATE TABLE "critical_ingredient_rule_components" (
  "rule_version_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "safety_stock_micros" BIGINT NOT NULL,
  CONSTRAINT "critical_ingredient_rule_components_pkey" PRIMARY KEY ("rule_version_id", "inventory_item_id"),
  CONSTRAINT "critical_ingredient_safety_stock_check" CHECK ("safety_stock_micros" >= 0)
);

CREATE TABLE "critical_ingredient_rule_locations" (
  "rule_version_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  CONSTRAINT "critical_ingredient_rule_locations_pkey" PRIMARY KEY ("rule_version_id", "inventory_item_id", "location_id")
);

CREATE TABLE "manual_availability_events" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "target_kind" "AvailabilityTargetKind" NOT NULL,
  "target_key" VARCHAR(64) NOT NULL,
  "menu_item_id" UUID,
  "menu_variant_id" UUID,
  "menu_modifier_id" UUID,
  "state" "ManualAvailabilityState" NOT NULL,
  "revision" INTEGER NOT NULL,
  "actor_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3),
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manual_availability_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_availability_values_check" CHECK (
    "revision" > 0 AND length(btrim("reason")) >= 3 AND
    ("expires_at" IS NULL OR "expires_at" > "effective_from") AND
    ("state" = 'UNAVAILABLE' OR "expires_at" IS NULL)
  ),
  CONSTRAINT "manual_availability_target_check" CHECK (
    ("target_kind" = 'ITEM' AND "menu_item_id" IS NOT NULL AND "menu_variant_id" IS NULL AND "menu_modifier_id" IS NULL AND "target_key" = 'ITEM:' || "menu_item_id"::text) OR
    ("target_kind" = 'VARIANT' AND "menu_item_id" IS NOT NULL AND "menu_variant_id" IS NOT NULL AND "menu_modifier_id" IS NULL AND "target_key" = 'VARIANT:' || "menu_variant_id"::text) OR
    ("target_kind" = 'MODIFIER' AND "menu_item_id" IS NULL AND "menu_variant_id" IS NULL AND "menu_modifier_id" IS NOT NULL AND "target_key" = 'MODIFIER:' || "menu_modifier_id"::text)
  )
);

CREATE UNIQUE INDEX "critical_ingredient_rule_versions_branch_target_version_key" ON "critical_ingredient_rule_versions"("branch_id", "menu_item_id", "menu_variant_id", "version") NULLS NOT DISTINCT;
CREATE INDEX "critical_ingredient_rule_versions_branch_target_status_effective_idx" ON "critical_ingredient_rule_versions"("branch_id", "menu_item_id", "menu_variant_id", "status", "effective_from");
CREATE UNIQUE INDEX "critical_ingredient_rule_active_effective_key" ON "critical_ingredient_rule_versions"("branch_id", "menu_item_id", "menu_variant_id", "effective_from") NULLS NOT DISTINCT WHERE "status" = 'ACTIVE';
CREATE INDEX "critical_ingredient_rule_versions_recipe_version_id_idx" ON "critical_ingredient_rule_versions"("recipe_version_id");
CREATE INDEX "critical_ingredient_rule_versions_created_by_id_idx" ON "critical_ingredient_rule_versions"("created_by_id");
CREATE INDEX "critical_ingredient_rule_versions_confirmed_by_id_idx" ON "critical_ingredient_rule_versions"("confirmed_by_id");
CREATE INDEX "critical_ingredient_rule_versions_activated_by_id_idx" ON "critical_ingredient_rule_versions"("activated_by_id");
CREATE INDEX "critical_ingredient_rule_components_branch_item_idx" ON "critical_ingredient_rule_components"("branch_id", "inventory_item_id");
CREATE INDEX "critical_ingredient_rule_locations_branch_location_idx" ON "critical_ingredient_rule_locations"("branch_id", "location_id");
CREATE INDEX "critical_ingredient_rule_locations_branch_item_idx" ON "critical_ingredient_rule_locations"("branch_id", "inventory_item_id");

CREATE UNIQUE INDEX "manual_availability_events_branch_target_revision_key" ON "manual_availability_events"("branch_id", "target_key", "revision");
CREATE INDEX "manual_availability_events_branch_target_effective_revision_idx" ON "manual_availability_events"("branch_id", "target_key", "effective_from", "revision" DESC);
CREATE INDEX "manual_availability_events_menu_item_id_idx" ON "manual_availability_events"("menu_item_id");
CREATE INDEX "manual_availability_events_menu_variant_id_idx" ON "manual_availability_events"("menu_variant_id");
CREATE INDEX "manual_availability_events_menu_modifier_id_idx" ON "manual_availability_events"("menu_modifier_id");
CREATE INDEX "manual_availability_events_actor_id_idx" ON "manual_availability_events"("actor_id");
CREATE INDEX "manual_availability_events_device_id_idx" ON "manual_availability_events"("device_id");
CREATE INDEX "manual_availability_active_unavailable_idx" ON "manual_availability_events"("branch_id", "effective_from", "expires_at") WHERE "state" = 'UNAVAILABLE';

ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_item_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_variant_fkey" FOREIGN KEY ("menu_variant_id") REFERENCES "menu_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_recipe_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_confirmed_by_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_versions" ADD CONSTRAINT "critical_ingredient_rule_activated_by_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "critical_ingredient_rule_components" ADD CONSTRAINT "critical_ingredient_rule_component_rule_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "critical_ingredient_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_components" ADD CONSTRAINT "critical_ingredient_rule_component_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_components" ADD CONSTRAINT "critical_ingredient_rule_component_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "critical_ingredient_rule_locations" ADD CONSTRAINT "critical_ingredient_rule_location_component_fkey" FOREIGN KEY ("rule_version_id", "inventory_item_id") REFERENCES "critical_ingredient_rule_components"("rule_version_id", "inventory_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_locations" ADD CONSTRAINT "critical_ingredient_rule_location_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_ingredient_rule_locations" ADD CONSTRAINT "critical_ingredient_rule_location_location_fkey" FOREIGN KEY ("branch_id", "location_id") REFERENCES "stock_locations"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_item_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_variant_fkey" FOREIGN KEY ("menu_variant_id") REFERENCES "menu_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_modifier_fkey" FOREIGN KEY ("menu_modifier_id") REFERENCES "menu_modifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_availability_events" ADD CONSTRAINT "manual_availability_event_device_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_availability_configuration_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'active availability configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER critical_ingredient_rule_active_immutable BEFORE UPDATE OR DELETE ON "critical_ingredient_rule_versions" FOR EACH ROW EXECUTE FUNCTION prevent_availability_configuration_mutation();

CREATE FUNCTION prevent_availability_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'availability history is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER critical_ingredient_rule_components_immutable BEFORE UPDATE OR DELETE ON "critical_ingredient_rule_components" FOR EACH ROW EXECUTE FUNCTION prevent_availability_history_mutation();
CREATE TRIGGER critical_ingredient_rule_locations_immutable BEFORE UPDATE OR DELETE ON "critical_ingredient_rule_locations" FOR EACH ROW EXECUTE FUNCTION prevent_availability_history_mutation();
CREATE TRIGGER manual_availability_events_immutable BEFORE UPDATE OR DELETE ON "manual_availability_events" FOR EACH ROW EXECUTE FUNCTION prevent_availability_history_mutation();

CREATE FUNCTION enforce_critical_ingredient_rule_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (SELECT 1 FROM menu_items WHERE id = NEW.menu_item_id AND branch_id = NEW.branch_id) OR
     (NEW.menu_variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_variants WHERE id = NEW.menu_variant_id AND menu_item_id = NEW.menu_item_id)) OR
     NOT EXISTS (
       SELECT 1 FROM recipe_versions r WHERE r.id = NEW.recipe_version_id AND r.branch_id = NEW.branch_id
         AND r.menu_item_id = NEW.menu_item_id AND r.menu_variant_id IS NOT DISTINCT FROM NEW.menu_variant_id
         AND r.status = 'ACTIVE' AND r.effective_from <= NEW.effective_from
     ) OR
     NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND organization_id = branch_org) OR
     (NEW.confirmed_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.confirmed_by_id AND organization_id = branch_org)) OR
     (NEW.activated_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.activated_by_id AND organization_id = branch_org)) THEN
    RAISE EXCEPTION 'critical ingredient rule scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER critical_ingredient_rule_scope_guard BEFORE INSERT OR UPDATE ON "critical_ingredient_rule_versions" FOR EACH ROW EXECUTE FUNCTION enforce_critical_ingredient_rule_scope();

CREATE FUNCTION enforce_critical_ingredient_component_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM critical_ingredient_rule_versions v
    JOIN recipe_components c ON c.recipe_version_id = v.recipe_version_id AND c.inventory_item_id = NEW.inventory_item_id
    WHERE v.id = NEW.rule_version_id AND v.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'critical ingredient is not in pinned recipe or branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER critical_ingredient_component_scope_guard BEFORE INSERT ON "critical_ingredient_rule_components" FOR EACH ROW EXECUTE FUNCTION enforce_critical_ingredient_component_scope();

CREATE FUNCTION enforce_critical_ingredient_location_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM critical_ingredient_rule_components c
    WHERE c.rule_version_id = NEW.rule_version_id AND c.inventory_item_id = NEW.inventory_item_id AND c.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'critical ingredient location branch mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER critical_ingredient_location_scope_guard BEFORE INSERT ON "critical_ingredient_rule_locations" FOR EACH ROW EXECUTE FUNCTION enforce_critical_ingredient_location_scope();

CREATE FUNCTION enforce_critical_ingredient_rule_shape() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND (
    NOT EXISTS (SELECT 1 FROM critical_ingredient_rule_components WHERE rule_version_id = NEW.id) OR
    EXISTS (
      SELECT 1 FROM critical_ingredient_rule_components c
      WHERE c.rule_version_id = NEW.id AND NOT EXISTS (
        SELECT 1 FROM critical_ingredient_rule_locations l
        WHERE l.rule_version_id = c.rule_version_id AND l.inventory_item_id = c.inventory_item_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'active critical ingredient rule requires configured locations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER critical_ingredient_rule_shape_guard AFTER INSERT OR UPDATE ON "critical_ingredient_rule_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_critical_ingredient_rule_shape();

CREATE FUNCTION enforce_manual_availability_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) OR
     (NEW.target_kind = 'ITEM' AND NOT EXISTS (SELECT 1 FROM menu_items WHERE id = NEW.menu_item_id AND branch_id = NEW.branch_id)) OR
     (NEW.target_kind = 'VARIANT' AND NOT EXISTS (
       SELECT 1 FROM menu_variants v JOIN menu_items i ON i.id = v.menu_item_id
       WHERE v.id = NEW.menu_variant_id AND i.id = NEW.menu_item_id AND i.branch_id = NEW.branch_id
     )) OR
     (NEW.target_kind = 'MODIFIER' AND NOT EXISTS (
       SELECT 1 FROM menu_modifiers m JOIN modifier_groups g ON g.id = m.modifier_group_id
       WHERE m.id = NEW.menu_modifier_id AND g.branch_id = NEW.branch_id
     )) THEN
    RAISE EXCEPTION 'manual availability event scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER manual_availability_scope_guard BEFORE INSERT ON "manual_availability_events" FOR EACH ROW EXECUTE FUNCTION enforce_manual_availability_scope();
