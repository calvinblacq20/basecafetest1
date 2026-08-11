-- Keep polymorphic trigger fields inside their matching table branch.
-- Two independent IF expressions caused PostgreSQL to resolve a field that
-- does not exist on recipe_components after a valid recipe component insert.
CREATE OR REPLACE FUNCTION enforce_inventory_child_branch() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'recipe_components' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM recipe_versions r
      JOIN inventory_items i ON i.id = NEW.inventory_item_id
      WHERE r.id = NEW.recipe_version_id
        AND r.branch_id = i.branch_id
    ) THEN
      RAISE EXCEPTION 'recipe component branch mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stock_count_lines' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM stock_counts c
      JOIN inventory_items i ON i.id = NEW.inventory_item_id
      WHERE c.id = NEW.stock_count_id
        AND c.branch_id = i.branch_id
    ) THEN
      RAISE EXCEPTION 'stock count line branch mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
