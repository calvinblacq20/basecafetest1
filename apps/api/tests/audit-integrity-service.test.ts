import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { hashAuditBatch } from "../src/audit/audit-integrity-hash.js";
import { AuditIntegrityService } from "../src/audit/audit-integrity.service.js";
import type { AuthPrincipal } from "../src/auth/auth.types.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";
const batchId = "00000000-0000-4000-8000-000000000004";
const eventId = "00000000-0000-4000-8000-000000000005";

const principal = (permissions: string[]): AuthPrincipal => ({
  userId,
  organizationId,
  deviceId,
  displayName: "Auditor",
  email: "auditor@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "ORGANIZATION", branchId: null, permissions }],
});

const event = {
  id: eventId,
  organizationId,
  branchId: null,
  actorId: userId,
  action: "orders.cancel",
  entityType: "order",
  entityId: null,
  outcome: "SUCCEEDED" as const,
  reason: "Reviewed cancellation",
  metadata: { safe: true },
  occurredAt: new Date("2026-08-08T08:00:00.000Z"),
};

describe("AuditIntegrityService", () => {
  it("requires an organization-scoped permission", async () => {
    const service = new AuditIntegrityService({} as never);
    await expect(
      service.list({ limit: 25 }, principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates one batch with audit, outbox, and idempotency evidence", async () => {
    const transaction = {
      auditIntegrityBatch: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({
          ...data,
          algorithm: "SHA256",
          schemaVersion: 1,
          createdAt: new Date("2026-08-08T09:01:00.000Z"),
        })),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([event]),
        create: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(transaction)),
    };
    const service = new AuditIntegrityService(prisma as never);
    const result = await service.create(
      {
        batchId,
        through: "2026-08-08T09:00:00.000Z",
        maxEvents: 5000,
        reason: "Daily manual integrity seal",
      },
      "audit-batch-0001",
      principal(["audit.integrity.manage"]),
    );
    expect(result).toMatchObject({ id: batchId, sequence: 1, eventCount: 1 });
    expect(transaction.auditIntegrityBatch.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });

  it("reports a changed event as an invalid chain", async () => {
    const batchHash = hashAuditBatch({
      organizationId,
      sequence: 1,
      previousHash: "0".repeat(64),
      events: [event],
    });
    const batch = {
      id: batchId,
      organizationId,
      sequence: 1,
      algorithm: "SHA256",
      schemaVersion: 1,
      previousHash: "0".repeat(64),
      batchHash,
      eventCount: 1,
      firstEventId: eventId,
      firstEventOccurredAt: event.occurredAt,
      lastEventId: eventId,
      lastEventOccurredAt: event.occurredAt,
      throughAt: event.occurredAt,
      createdById: userId,
      reason: "Seal",
      createdAt: event.occurredAt,
    };
    const transaction = {
      auditIntegrityBatch: {
        findMany: vi.fn().mockResolvedValue([batch]),
      },
      auditLog: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ ...event, reason: "Tampered reason" }]),
        create: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(transaction)),
    };
    const service = new AuditIntegrityService(prisma as never);
    await expect(
      service.verify(
        { fromSequence: 1, maxBatches: 100, reason: "Review chain" },
        "audit-verify-0001",
        principal(["audit.integrity.read"]),
      ),
    ).resolves.toMatchObject({
      status: "INVALID",
      issues: [{ code: "AUDIT_CHAIN_HASH_MISMATCH", sequence: 1 }],
    });
  });
});
