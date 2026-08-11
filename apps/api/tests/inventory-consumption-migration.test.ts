import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070020_inventory_consumption_policy/migration.sql",
  ),
  "utf8",
);

describe("inventory consumption migration", () => {
  it.each([
    "inventory_deduction_policy_lifecycle_check",
    "inventory_consumption_route_active_effective_key",
    "inventory_deduction_policy_active_immutable",
    "inventory_consumption_entries_immutable",
    "inventory_consumption_revision_guard",
    "inventory consumption scope mismatch",
    "inventory consumption entry or ledger mismatch",
    "inventory consumption reversal ledger mismatch",
    "inventory deduction policy actor scope mismatch",
    "inventory consumption route scope mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
