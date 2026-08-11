import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070014_refunds_reversals/migration.sql",
  ),
  "utf8",
);
describe("refund migration", () => {
  it.each([
    "refund exceeds refundable payment amount",
    "confirmed_refund_balance_guard",
    "refund_approvals_append_only",
    "refund_receipts_append_only",
    "refund_fiscal_disabled",
    "invalid refund transition",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
