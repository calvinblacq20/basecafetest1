import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608080001_operational_recovery_foundation/migration.sql",
  ),
  "utf8",
);

describe("operational recovery migration", () => {
  it("retains immutable evidence and organization-scoped permissions", () => {
    expect(sql).toContain('CREATE TABLE "operational_evidence"');
    expect(sql).toContain("operational_evidence_reject_update");
    expect(sql).toContain("operational_evidence_reject_delete");
    expect(sql).toContain("operational_evidence_restore_success_check");
    expect(sql).toContain("operations.read");
    expect(sql).toContain("operations.manage");
  });
});
