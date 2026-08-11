import {
  recordOperationalEvidenceRequestSchema,
  readinessResponseSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const base = {
  evidenceId: "00000000-0000-4000-8000-000000000001",
  source: "LOCAL_ENCRYPTED_ARCHIVE" as const,
  startedAt: "2026-08-08T01:00:00.000Z",
  completedAt: "2026-08-08T01:10:00.000Z",
  encrypted: true,
  checksumSha256: "a".repeat(64),
  artifactReference: "base-cafe-backup.bcpos",
  retentionUntil: "2026-09-08T01:10:00.000Z",
  applicationVersion: "0.1.0",
  schemaVersion: "202608080001_operational_recovery_foundation",
  failureCode: null,
  safeFailureMessage: null,
  reason: "Reviewed automated recovery evidence.",
};

describe("operations contracts", () => {
  it("accepts complete encrypted backup evidence", () => {
    expect(
      recordOperationalEvidenceRequestSchema.parse({
        ...base,
        kind: "BACKUP",
        outcome: "SUCCEEDED",
        checks: { archiveCreated: true },
      }),
    ).toMatchObject({ kind: "BACKUP", encrypted: true });
  });

  it("rejects a restore success without a real database and integrity check", () => {
    expect(() =>
      recordOperationalEvidenceRequestSchema.parse({
        ...base,
        kind: "RESTORE_DRILL",
        outcome: "SUCCEEDED",
        checks: { archiveReadable: true },
      }),
    ).toThrow("database restore");
  });

  it("keeps dependency readiness separate from operational recovery alerts", () => {
    expect(
      readinessResponseSchema.parse({
        status: "ok",
        service: "base-cafe-api",
        version: "0.1.0",
        timestamp: "2026-08-08T01:00:00.000Z",
        database: "up",
        outbox: { unpublishedCount: 2, oldestUnpublishedAt: null },
      }),
    ).toMatchObject({ status: "ok", database: "up" });
  });
});
