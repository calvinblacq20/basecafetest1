import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070010_order_sending_kds/migration.sql",
  ),
  "utf8",
);

describe("order sending and KDS migration", () => {
  it.each([
    "order_send_waves_immutable",
    "preparation_ticket_lifecycle_guard",
    "preparation_events_append_only",
    "preparation_ticket_item_entry_unique",
    "sent_cancellations_append_only",
    "send wave tenant, branch, device, or actor mismatch",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
