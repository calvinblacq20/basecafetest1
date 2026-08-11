import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070017_inventory_stock_ledger/migration.sql",
  ),
  "utf8",
);
const childTriggerFixSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608090003_inventory_child_trigger_fix/migration.sql",
  ),
  "utf8",
);
const modifierScopeFixSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608090004_modifier_effect_scope_column_fix/migration.sql",
  ),
  "utf8",
);
const historyTriggerFixSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608090005_inventory_history_trigger_fix/migration.sql",
  ),
  "utf8",
);
const productionTriggerBranchFixSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608100001_production_configuration_trigger_branch_fix/migration.sql",
  ),
  "utf8",
);

describe("inventory migration", () => {
  it.each([
    "stock_ledger_append_only",
    "stock_ledger_nonzero_check",
    "stock_ledger_balance_idx",
    "inventory_conversion_tenant_guard",
    "recipe_component_branch_guard",
    "active_recipe_immutable",
    "posted_stock_count_immutable",
    "inventory_transfer_values_check",
    "stock_count_lifecycle_check",
  ])("contains %s", (guard) => expect(sql).toContain(guard));

  it("branches polymorphic child trigger fields before resolving NEW", () => {
    expect(childTriggerFixSql).toContain(
      "ELSIF TG_TABLE_NAME = 'stock_count_lines'",
    );
    expect(childTriggerFixSql).not.toContain(
      "IF TG_TABLE_NAME = 'stock_count_lines' AND",
    );
  });

  it("uses the physical modifier-group foreign-key column", () => {
    expect(modifierScopeFixSql).toContain("g.id = m.modifier_group_id");
    expect(modifierScopeFixSql).not.toContain("g.id = m.group_id");
  });

  it("isolates polymorphic immutable-history fields by table", () => {
    expect(historyTriggerFixSql).toContain(
      "ELSIF TG_TABLE_NAME = 'recipe_components'",
    );
    expect(historyTriggerFixSql).toContain(
      "ELSIF TG_TABLE_NAME = 'stock_count_lines'",
    );
    expect(historyTriggerFixSql).not.toContain("ROW(NEW.*)");
  });

  it("resolves modifier fields only for modifier configuration rows", () => {
    expect(productionTriggerBranchFixSql).toContain(
      "IF TG_TABLE_NAME = 'modifier_recipe_effect_versions' THEN",
    );
    expect(productionTriggerBranchFixSql).not.toContain(
      "TG_TABLE_NAME = 'modifier_recipe_effect_versions' AND",
    );
  });
});
