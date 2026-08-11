import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070013_receipts_print_fiscal/migration.sql",
  ),
  "utf8",
);
describe("receipt migration", () => {
  it.each([
    "fiscal_official_fields_guard",
    "receipts_append_only",
    "receipt_reprints_append_only",
    "print_jobs_lifecycle_guard",
    "receipt tenant, order, or completion mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
