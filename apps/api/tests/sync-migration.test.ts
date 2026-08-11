import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608070023_offline_sync_foundation/migration.sql",
  ),
  "utf8",
);

describe("offline sync migration", () => {
  it.each([
    "sync_command_receipts_device_id_local_sequence_key",
    "sync_command_schema_version_check",
    "sync_command_payload_hash_check",
    "sync_command_type_check",
    "sync_command_status_check",
    "sync_command_scope_guard_trigger",
    "sync command receipts are append-only",
  ])("contains %s", (guard) => expect(sql).toContain(guard));
});
