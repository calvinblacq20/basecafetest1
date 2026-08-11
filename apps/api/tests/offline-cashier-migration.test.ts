import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070024_offline_cashier_commands/migration.sql",
  ),
  "utf8",
);

describe("offline cashier command migration", () => {
  it.each(["ORDER_LINE_REPLACE", "ORDER_LINE_REMOVE", "ORDER_COMPLETE"])(
    "allows %s receipts",
    (command) => expect(sql).toContain(`'${command}'`),
  );
});
