-- Resolve OLD/NEW fields only inside the table branch that owns them. This
-- preserves immutable active recipes and posted counts while allowing their
-- valid draft-to-active/post transitions.
CREATE OR REPLACE FUNCTION enforce_inventory_history() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'recipe_versions' THEN
    IF OLD.status = 'ACTIVE'
       AND (TG_OP = 'DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'active recipe versions are immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'recipe_components' THEN
    IF EXISTS (
      SELECT 1 FROM recipe_versions
      WHERE id = OLD.recipe_version_id AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'active recipe components are immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stock_counts' THEN
    IF OLD.status <> 'DRAFT'
       AND (TG_OP = 'DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'posted or cancelled stock counts are immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stock_count_lines' THEN
    IF EXISTS (
      SELECT 1 FROM stock_counts
      WHERE id = OLD.stock_count_id AND status <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'posted stock count lines are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
