import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { BranchHoursService } from "../src/branch-hours/branch-hours.service.js";
import { requestHash } from "../src/common/request-hash.js";
import type { PrismaService } from "../src/database/prisma.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const otherBranchId = "10000000-0000-4000-8000-000000000009";
const userId = "10000000-0000-4000-8000-000000000004";

const input = {
  branchId,
  effectiveFrom: "2026-08-20",
  businessDayCutoffMinute: 240,
  windows: [{ isoWeekday: 1, opensAtMinute: 720, durationMinutes: 720 }],
  reason: "Prepare confirmed hours",
};

function principal(
  permissions: readonly string[] = ["branch-hours.manage"],
  assignedBranchId = branchId,
): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId: "10000000-0000-4000-8000-000000000003",
    displayName: "Test manager",
    email: "manager@example.test",
    mustChangePassword: false,
    assignments: [{ scope: "BRANCH", branchId: assignedBranchId, permissions }],
  };
}

describe("branch-hours service controls", () => {
  it("denies missing and cross-branch permissions before accessing persistence", async () => {
    const findUnique = vi.fn();
    const service = new BranchHoursService({
      idempotencyRecord: { findUnique },
    } as unknown as PrismaService);

    await expect(
      service.createSchedule(input, "hours-create-1", principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createSchedule(
        input,
        "hours-create-2",
        principal(["branch-hours.manage"], otherBranchId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("hides a branch belonging to another organization", async () => {
    const transaction = {
      branch: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (client: unknown) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new BranchHoursService(prisma).createSchedule(
        input,
        "hours-create-tenant",
        principal(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("commits the schedule, audit, outbox, and replay record together", async () => {
    const response = {
      id: "10000000-0000-4000-8000-000000000010",
      branchId,
      effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
      businessDayCutoffMinute: 240,
      status: "DRAFT",
      revision: 1,
      windows: input.windows,
    };
    const transaction = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      branchScheduleVersion: { create: vi.fn().mockResolvedValue(response) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (client: unknown) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new BranchHoursService(prisma).createSchedule(
      input,
      "hours-create-atomic",
      principal(),
    );

    expect(result).toMatchObject({ id: response.id, status: "DRAFT" });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.idempotencyRecord.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: response.id,
        eventType: "branch-hours.schedule.created",
      }),
    });
  });

  it("replays an identical idempotent request and rejects key reuse", async () => {
    const replay = { id: "existing-schedule", status: "DRAFT" };
    const findUnique = vi.fn().mockResolvedValue({
      requestHash: requestHash(input),
      responseBody: replay,
    });
    const transaction = vi.fn();
    const service = new BranchHoursService({
      idempotencyRecord: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(
      service.createSchedule(input, "hours-create-replay", principal()),
    ).resolves.toEqual(replay);
    expect(transaction).not.toHaveBeenCalled();

    await expect(
      service.createSchedule(
        { ...input, businessDayCutoffMinute: 300 },
        "hours-create-replay",
        principal(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
