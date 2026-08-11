import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070021_modifier_batch_automation/migration.sql",
  ),
  "utf8",
);

describe("modifier and batch production migration", () => {
  it.each([
    "modifier_recipe_effect_active_effective_key",
    "modifier_recipe_effect_shape_guard",
    "inventory_consumption_modifier_effect_scope_guard",
    "batch_recipe_active_effective_key",
    "batch_recipe_component_scope_guard",
    "batch production scope or output ledger mismatch",
    "batch production input or ledger mismatch",
    "batch production reversal ledger mismatch",
    "batch_production_revision_guard",
    "production history is append-only",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
