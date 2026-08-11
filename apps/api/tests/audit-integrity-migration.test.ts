import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608080004_audit_integrity_chain/migration.sql",
  ),
  "utf8",
);

describe("audit integrity migration", () => {
  it("adds an append-only, tenant-bound, sequential chain", () => {
    expect(sql).toContain('CREATE TABLE "audit_integrity_batches"');
    expect(sql).toContain("audit_integrity_batch_insert_guard");
    expect(sql).toContain("audit_integrity_batches_reject_update");
    expect(sql).toContain("audit_integrity_batches_reject_delete");
    expect(sql).toContain("audit integrity chain predecessor mismatch");
  });

  it.each(["audit.integrity.read", "audit.integrity.manage"])(
    "installs %s",
    (permission) => expect(sql).toContain(permission),
  );
});
