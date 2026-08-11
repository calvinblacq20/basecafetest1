import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608100002_optional_totp_mfa/migration.sql",
  ),
  "utf8",
);
const resetSql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608100003_mfa_pending_reset_transition/migration.sql",
  ),
  "utf8",
);

describe("optional TOTP MFA migration", () => {
  it("retains credential history and permits only one current credential", () => {
    expect(sql).toContain('CREATE TABLE "user_mfa_credentials"');
    expect(sql).toContain("WHERE \"status\" <> 'DISABLED'");
    expect(sql).toContain("user_mfa_credentials_protect_history");
    expect(sql).toContain("user_mfa_credentials_reject_delete");
    expect(sql).toContain("organization must match its user");
  });

  it("stores one-time recovery hashes as append-only records", () => {
    expect(sql).toContain('"code_hash" CHAR(64)');
    expect(sql).toContain("mfa_recovery_codes_protect_update");
    expect(sql).toContain("mfa_recovery_codes_reject_delete");
    expect(sql).not.toContain('"recovery_code"');
  });

  it("allows a stranded pending enrollment to become retained disabled history", () => {
    expect(resetSql).toContain(
      "OLD.\"status\" = 'PENDING' AND NEW.\"status\" = 'DISABLED'",
    );
    expect(resetSql).toContain('NEW."revision" = OLD."revision" + 1');
    expect(resetSql).not.toContain("DELETE FROM");
  });
});
