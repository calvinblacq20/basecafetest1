import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070025_offline_recovery_hardening/migration.sql",
  ),
  "utf8",
);

describe("offline recovery migration", () => {
  it("keeps manager resolutions append-only and registers explicit permissions", () => {
    expect(sql).toContain('CREATE TABLE "sync_command_resolutions"');
    expect(sql).toContain("sync_command_resolutions_reject_update");
    expect(sql).toContain("sync_command_resolutions_scope_guard");
    expect(sql).toContain("sync_command_resolutions_reject_delete");
    expect(sql).toContain("SUPERSEDED_BY_COMMAND");
    expect(sql).toContain("sync.recovery.read");
    expect(sql).toContain("sync.recovery.manage");
  });
});
