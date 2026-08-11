import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608080003_security_operations_foundation/migration.sql",
  ),
  "utf8",
);

describe("security operations migration", () => {
  it("persists lifecycle history and protects session and tenant boundaries", () => {
    expect(sql).toContain('CREATE TABLE "security_alerts"');
    expect(sql).toContain('CREATE TABLE "security_alert_events"');
    expect(sql).toContain("security_alert_events_reject_update");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "security_alert_events"');
    expect(sql).toContain("session_security_lifecycle_guard");
    expect(sql).toContain("security_alerts_tenant_guard");
  });

  it("installs the separate security, audit export, and privacy key permissions", () => {
    for (const permission of [
      "audit.export",
      "security.alerts.read",
      "security.alerts.manage",
      "security.sessions.read",
      "security.sessions.manage",
      "privacy.keys.read",
      "privacy.keys.manage",
    ])
      expect(sql).toContain(permission);
  });
});
