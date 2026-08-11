-- Batch recipe rows do not own menu_modifier_id. Keep the modifier-only lookup
-- inside the modifier table branch so PostgreSQL never resolves that field for
-- batch_recipe_versions.
CREATE OR REPLACE FUNCTION enforce_production_configuration_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (
       SELECT 1 FROM users
       WHERE id = NEW.created_by_id AND organization_id = branch_org
     ) OR (
       NEW.activated_by_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM users
         WHERE id = NEW.activated_by_id AND organization_id = branch_org
       )
     ) THEN
    RAISE EXCEPTION 'production configuration actor scope mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'modifier_recipe_effect_versions' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM menu_modifiers m
      JOIN modifier_groups g ON g.id = m.modifier_group_id
      WHERE m.id = NEW.menu_modifier_id
        AND g.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION 'modifier recipe effect branch mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
