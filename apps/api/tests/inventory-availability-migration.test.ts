import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070022_inventory_availability/migration.sql",
  ),
  "utf8",
);

describe("inventory availability migration", () => {
  it.each([
    "critical_ingredient_rule_lifecycle_check",
    "critical_ingredient_rule_active_effective_key",
    "manual_availability_events_branch_target_revision_key",
    "manual_availability_active_unavailable_idx",
    "active availability configuration is immutable",
    "availability history is append-only",
    "critical ingredient is not in pinned recipe or branch",
    "active critical ingredient rule requires configured locations",
    "manual availability event scope mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
