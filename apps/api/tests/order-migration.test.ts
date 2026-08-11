import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608060009_core_orders/migration.sql",
  ),
  "utf8",
);

describe("core order migration", () => {
  it.each([
    "orders_one_normal_active_per_table",
    "orders_totals_reconcile",
    "order_lines_input_reconcile",
    "orders_scope_guard",
    "orders_lifecycle_guard",
    "order_events_append_only",
    "orders_no_delete",
  ])("contains %s", (constraint) => expect(sql).toContain(constraint));
});
