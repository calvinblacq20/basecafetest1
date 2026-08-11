import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608090001_pilot_readiness_gate/migration.sql",
  ),
  "utf8",
);

describe("pilot readiness migration", () => {
  it("retains tenant-bound append-only evidence and review history", () => {
    expect(sql).toContain('CREATE TABLE "pilot_readiness_evidence"');
    expect(sql).toContain('CREATE TABLE "pilot_readiness_reviews"');
    expect(sql).toContain("pilot_readiness_tenant_guard");
    expect(sql).toContain("pilot_readiness_evidence_reject_update");
    expect(sql).toContain("pilot_readiness_reviews_reject_delete");
  });

  it.each(["release.read", "release.manage"])("installs %s", (permission) =>
    expect(sql).toContain(permission),
  );
});
