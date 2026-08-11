import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070015_cash_movements/migration.sql",
  ),
  "utf8",
);
const correctionSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608090002_cash_movement_correction_link/migration.sql",
  ),
  "utf8",
);

describe("cash movement migration", () => {
  it.each([
    "cash_movement_type_direction",
    "cash_movement_status_timestamps",
    "cash movement tenant, currency, or open shift mismatch",
    "invalid cash movement transition",
    "invalid cash movement approval separation or scope",
    "cash_movements_no_delete",
    "cash_movement_approvals_append_only",
  ])("contains %s", (guard) => expect(sql).toContain(guard));

  it.each([
    'ADD COLUMN "corrects_movement_id" UUID',
    "cash_movement_correction_reference",
    "cash_movements_corrects_movement_id_fkey",
    "cash correction must reference a posted movement in the same branch and currency",
    'NEW."corrects_movement_id"',
  ])("retains correction history through %s", (guard) =>
    expect(correctionSql).toContain(guard),
  );
});
