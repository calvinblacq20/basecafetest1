import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070016_daily_reporting/migration.sql",
  ),
  "utf8",
);

describe("report migration", () => {
  it.each([
    "category_key_snapshot",
    "category_name_snapshot",
    "orders_branch_status_completed_at_idx",
    "payments_branch_status_confirmed_at_idx",
    "refunds_branch_status_confirmed_at_idx",
    "cash_movements_branch_status_posted_at_idx",
    "order_lines_category_snapshot_guard",
    "new order lines require immutable category snapshots",
    "UNSNAPSHOTTED",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
