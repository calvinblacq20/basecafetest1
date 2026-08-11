DROP INDEX "recipe_versions_branch_item_variant_version_key";
CREATE UNIQUE INDEX "recipe_versions_branch_item_variant_version_key"
ON "recipe_versions"("branch_id", "menu_item_id", "menu_variant_id", "version") NULLS NOT DISTINCT;

CREATE FUNCTION enforce_inventory_conversion_dimension() RETURNS trigger AS $$
DECLARE from_dimension "InventoryUnitDimension";
DECLARE to_dimension "InventoryUnitDimension";
BEGIN
  SELECT dimension INTO from_dimension FROM inventory_units WHERE id = NEW.from_unit_id;
  SELECT dimension INTO to_dimension FROM inventory_units WHERE id = NEW.to_unit_id;
  IF from_dimension IS DISTINCT FROM to_dimension THEN
    RAISE EXCEPTION 'inventory conversion dimension mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_conversion_dimension_guard
BEFORE INSERT OR UPDATE ON "inventory_unit_conversions"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_conversion_dimension();

CREATE FUNCTION enforce_inventory_actor_device_scope() RETURNS trigger AS $$
DECLARE expected_organization UUID;
BEGIN
  SELECT organization_id INTO expected_organization FROM branches WHERE id = NEW.branch_id;
  IF TG_TABLE_NAME IN ('stock_ledger_entries', 'inventory_transfers') THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND organization_id = expected_organization) OR
       NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = expected_organization AND branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'inventory actor or device scope mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stock_counts' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND organization_id = expected_organization) OR
       (NEW.posted_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.posted_by_id AND organization_id = expected_organization)) THEN
      RAISE EXCEPTION 'stock count actor scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_actor_device_guard
BEFORE INSERT OR UPDATE ON "stock_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_device_scope();
CREATE TRIGGER inventory_transfer_actor_device_guard
BEFORE INSERT OR UPDATE ON "inventory_transfers"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_device_scope();
CREATE TRIGGER stock_count_actor_guard
BEFORE INSERT OR UPDATE ON "stock_counts"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_device_scope();

CREATE FUNCTION enforce_inventory_transfer_pair() RETURNS trigger AS $$
DECLARE entry_count INTEGER;
DECLARE entry_sum NUMERIC;
DECLARE outbound_count INTEGER;
DECLARE inbound_count INTEGER;
BEGIN
  IF NEW.source_type <> 'INVENTORY_TRANSFER' THEN RETURN NEW; END IF;
  SELECT count(*), coalesce(sum(quantity_delta_micros), 0),
         count(*) FILTER (WHERE type = 'TRANSFER_OUT'),
         count(*) FILTER (WHERE type = 'TRANSFER_IN')
    INTO entry_count, entry_sum, outbound_count, inbound_count
    FROM stock_ledger_entries WHERE source_type = NEW.source_type AND source_id = NEW.source_id;
  IF entry_count <> 2 OR entry_sum <> 0 OR outbound_count <> 1 OR inbound_count <> 1 THEN
    RAISE EXCEPTION 'inventory transfer ledger pair mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER inventory_transfer_pair_guard
AFTER INSERT ON "stock_ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_transfer_pair();
