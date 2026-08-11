import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070018_inventory_constraint_hardening/migration.sql",
  ),
  "utf8",
);

describe("inventory constraint hardening migration", () => {
  it.each([
    "NULLS NOT DISTINCT",
    "inventory_conversion_dimension_guard",
    "stock_ledger_actor_device_guard",
    "inventory_transfer_pair_guard",
    "DEFERRABLE INITIALLY DEFERRED",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
