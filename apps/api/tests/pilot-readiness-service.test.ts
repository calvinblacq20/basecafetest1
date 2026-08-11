import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { PilotReadinessService } from "../src/operations/pilot-readiness.service.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";
const evidenceId = "00000000-0000-4000-8000-000000000004";

const principal = (
  permissions: string[],
  scope = "ORGANIZATION",
): AuthPrincipal => ({
  userId,
  organizationId,
  deviceId,
  displayName: "Release Manager",
  email: "release@example.test",
  mustChangePassword: false,
  assignments: [
    {
      scope: scope as "ORGANIZATION" | "BRANCH",
      branchId:
        scope === "BRANCH" ? "00000000-0000-4000-8000-000000000005" : null,
      permissions,
    },
  ],
});

const input = {
  evidenceId,
  code: "OFFLINE_DRILL_PASSED" as const,
  outcome: "CONFIRMED" as const,
  observedAt: "2026-08-09T06:00:00.000Z",
  safeReference: "drill-2026-08-09",
  reason: "Witnessed outage, restart, reconnect, and reconciliation drill.",
};

describe("PilotReadinessService", () => {
  it("requires organization-scoped release permission", async () => {
    const service = new PilotReadinessService({} as never);
    await expect(
      service.listEvidence(
        { limit: 25 },
        principal(["release.read"], "BRANCH"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects references that look like credential material", async () => {
    const service = new PilotReadinessService({} as never);
    await expect(
      service.recordEvidence(
        { ...input, safeReference: "provider-api-key-secret" },
        "readiness-evidence-0001",
        principal(["release.manage"]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("records evidence with audit, outbox, and idempotency", async () => {
    const transaction = {
      pilotReadinessEvidence: {
        create: vi.fn().mockImplementation(({ data }) => ({
          ...data,
          recordedAt: new Date("2026-08-09T06:01:00.000Z"),
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(transaction)),
    };
    const service = new PilotReadinessService(prisma as never);
    await expect(
      service.recordEvidence(
        input,
        "readiness-evidence-0002",
        principal(["release.manage"]),
      ),
    ).resolves.toMatchObject({ id: evidenceId, outcome: "CONFIRMED" });
    expect(transaction.pilotReadinessEvidence.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
  });
});
