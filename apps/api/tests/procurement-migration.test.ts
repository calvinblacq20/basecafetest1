import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070019_procurement_receiving/migration.sql",
  ),
  "utf8",
);

describe("procurement migration", () => {
  it.each([
    "purchase_order_lifecycle_check",
    "purchase_order_transition_guard",
    "goods_receipts_immutable",
    "purchase_returns_immutable",
    "procurement document total mismatch",
    "purchase order over receipt",
    "purchase return exceeds receipt",
    "procurement actor or device scope mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
