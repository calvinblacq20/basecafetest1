import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070011_order_table_split_merge/migration.sql",
  ),
  "utf8",
);

describe("order table, transfer, merge, and split migration", () => {
  it.each([
    "order_table_movement_changes_table",
    "order_responsibility_changes_user",
    "order_merge_distinct",
    "order_split_remainder_required",
    "order_split_lines_scope_guard",
    "order_merges_append_only",
    "assigned server tenant mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
