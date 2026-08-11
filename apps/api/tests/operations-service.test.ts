import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { OperationsService } from "../src/operations/operations.service.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";
const evidenceId = "00000000-0000-4000-8000-000000000004";

const principal = (
  permissions: string[],
  scope: "ORGANIZATION" | "BRANCH" = "ORGANIZATION",
): AuthPrincipal => ({
  userId,
  organizationId,
  deviceId,
  displayName: "Operations Manager",
  email: "operations@example.test",
  mustChangePassword: false,
  assignments: [
    {
      scope,
      branchId:
        scope === "BRANCH" ? "00000000-0000-4000-8000-000000000005" : null,
      permissions,
    },
  ],
});

const backupInput = {
  evidenceId,
  kind: "BACKUP" as const,
  outcome: "SUCCEEDED" as const,
  source: "LOCAL_ENCRYPTED_ARCHIVE" as const,
  startedAt: "2026-08-08T01:00:00.000Z",
  completedAt: "2026-08-08T01:05:00.000Z",
  encrypted: true,
  checksumSha256: "a".repeat(64),
  artifactReference: "base-cafe-backup.bcpos",
  retentionUntil: "2026-09-08T01:05:00.000Z",
  applicationVersion: "0.1.0",
  schemaVersion: "202608080001_operational_recovery_foundation",
  checks: { archiveCreated: true },
  failureCode: null,
  safeFailureMessage: null,
  reason: "Reviewed automated backup evidence.",
};

describe("OperationsService", () => {
  it("requires organization-scoped permission for recovery evidence", async () => {
    const prisma = { operationalEvidence: { findMany: vi.fn() } };
    const service = new OperationsService(prisma as never);
    await expect(
      service.list({ limit: 50 }, principal(["operations.read"], "BRANCH")),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.operationalEvidence.findMany).not.toHaveBeenCalled();
  });

  it("records one immutable evidence row with audit, outbox, and idempotency", async () => {
    const evidence = {
      id: evidenceId,
      organizationId,
      kind: "BACKUP",
      outcome: "SUCCEEDED",
      source: "LOCAL_ENCRYPTED_ARCHIVE",
      startedAt: new Date(backupInput.startedAt),
      completedAt: new Date(backupInput.completedAt),
      encrypted: true,
      checksumSha256: backupInput.checksumSha256,
      artifactReference: backupInput.artifactReference,
      retentionUntil: new Date(backupInput.retentionUntil),
      applicationVersion: backupInput.applicationVersion,
      schemaVersion: backupInput.schemaVersion,
      checks: backupInput.checks,
      failureCode: null,
      safeFailureMessage: null,
      recordedById: userId,
      reason: backupInput.reason,
      recordedAt: new Date("2026-08-08T01:06:00.000Z"),
    };
    const transaction = {
      operationalEvidence: {
        create: vi.fn().mockResolvedValue(evidence),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new OperationsService(prisma as never);

    await expect(
      service.record(
        backupInput,
        "operations-evidence-0001",
        principal(["operations.manage"]),
      ),
    ).resolves.toMatchObject({ id: evidenceId, outcome: "SUCCEEDED" });
    expect(transaction.operationalEvidence.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });

  it("surfaces missing recovery evidence without marking the database unavailable", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          unpublishedCount: 3n,
          oldestUnpublishedAt: new Date("2026-08-08T01:00:00.000Z"),
          maximumAttempts: 2,
        },
      ]),
      syncCommandReceipt: { count: vi.fn().mockResolvedValue(1) },
      operationalEvidence: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (values: Promise<unknown>[]) =>
        Promise.all(values),
      ),
    };
    const service = new OperationsService(prisma as never);
    const result = await service.diagnostics(principal(["operations.read"]));
    expect(result.database).toBe("up");
    expect(result.outbox.unpublishedCount).toBe(3);
    expect(result.alerts.map((alert) => alert.code)).toEqual([
      "BACKUP_EVIDENCE_MISSING",
      "RESTORE_DRILL_EVIDENCE_MISSING",
      "SYNC_RECOVERY_REQUIRED",
    ]);
  });
});
