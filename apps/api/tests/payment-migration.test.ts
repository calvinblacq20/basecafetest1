import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070012_payments_allocations/migration.sql",
  ),
  "utf8",
);

describe("payment and allocation migration", () => {
  it.each([
    "payments_method_fields",
    "payments_status_timestamps",
    "payment_allocations_reconcile",
    "payment_status_balance_guard",
    "payment allocation order scope mismatch",
    "immutable payment facts changed",
    "payment_events_append_only",
    "OrderStatus\" ADD VALUE 'COMPLETED'",
  ])("contains %s", (guard) => expect(sql).toContain(guard));

  it("checks every allocation when a payment becomes confirmed", () => {
    expect(sql).toContain(
      'FOR allocated_order IN SELECT DISTINCT "order_id" FROM "payment_allocations"',
    );
  });
});
