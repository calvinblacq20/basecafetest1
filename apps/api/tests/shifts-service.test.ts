import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { BranchHoursService } from "../src/branch-hours/branch-hours.service.js";
import { requestHash } from "../src/common/request-hash.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { ShiftsService } from "../src/shifts/shifts.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const shiftId = "10000000-0000-4000-8000-000000000010";

const openInput = {
  shiftId,
  branchId,
  drawerKey: "TILL-1",
  openingFloatMinor: 10_000,
  reason: "Open for service",
};

function principal(permissions: readonly string[]): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId,
    displayName: "Cashier",
    email: "cashier@example.test",
    mustChangePassword: false,
    assignments: [{ scope: "BRANCH", branchId, permissions }],
  };
}

function hours(configurationReady = true) {
  return {
    resolveForTrustedBranch: vi.fn().mockResolvedValue(
      configurationReady
        ? {
            configurationReady: true,
            businessDate: "2026-08-06",
            scheduleVersionId: "10000000-0000-4000-8000-000000000030",
          }
        : {
            configurationReady: false,
            businessDate: null,
            scheduleVersionId: null,
          },
    ),
  } as unknown as BranchHoursService;
}

function openTransaction() {
  const response = {
    id: shiftId,
    branchId,
    deviceId,
    currentCashierId: userId,
    openingFloatMinor: 10_000,
    status: "OPEN",
    revision: 1,
  };
  return {
    response,
    client: {
      device: {
        findFirst: vi.fn().mockResolvedValue({
          id: deviceId,
          branch: {
            id: branchId,
            timezone: "Africa/Accra",
            currency: "GHS",
          },
        }),
      },
      staffShift: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(response),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    },
  };
}

describe("shift service controls", () => {
  it("denies cross-branch or missing permission before persistence", async () => {
    const findUnique = vi.fn();
    const service = new ShiftsService(
      { idempotencyRecord: { findUnique } } as unknown as PrismaService,
      hours(),
    );

    await expect(
      service.open(openInput, "shift-open-1", principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("hides branches outside the authenticated organization", async () => {
    const service = new ShiftsService(
      {
        branch: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as PrismaService,
      hours(),
    );

    await expect(
      service.list(branchId, principal(["shifts.read"])),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks opening when business-date configuration is missing", async () => {
    const { client } = openTransaction();
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma, hours(false));

    await expect(
      service.open(openInput, "shift-open-missing", principal(["shifts.open"])),
    ).rejects.toThrow("CONFIGURATION_MISSING");
    expect(client.staffShift.create).not.toHaveBeenCalled();
  });

  it("atomically records an opened shift, audit, outbox, and replay result", async () => {
    const { client, response } = openTransaction();
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;

    await expect(
      new ShiftsService(prisma, hours()).open(
        openInput,
        "shift-open-atomic",
        principal(["shifts.open"]),
      ),
    ).resolves.toMatchObject({ id: response.id, status: "OPEN" });
    expect(client.auditLog.create).toHaveBeenCalledOnce();
    expect(client.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: shiftId,
        eventType: "shift.opened",
      }),
    });
    expect(client.idempotencyRecord.create).toHaveBeenCalledOnce();
  });

  it("requires manager approval for a non-zero variance", async () => {
    const client = {
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({
          id: shiftId,
          branchId,
          status: "OPEN",
          revision: 1,
          currentCashierId: userId,
          openingFloatMinor: 10_000,
        }),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
      },
      refund: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
      },
      cashMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;

    await expect(
      new ShiftsService(prisma, hours()).close(
        shiftId,
        {
          branchId,
          revision: 1,
          countedCashMinor: 9_999,
          declaration: "Counted twice",
          reason: "End service",
        },
        "shift-close-variance",
        principal(["shifts.close"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("hands over responsibility without rewriting prior ownership", async () => {
    const receivingCashierId = "10000000-0000-4000-8000-000000000020";
    const openShift = {
      id: shiftId,
      branchId,
      status: "OPEN",
      revision: 1,
      currentCashierId: userId,
      openingFloatMinor: 10_000,
    };
    const handedOver = {
      ...openShift,
      revision: 2,
      currentCashierId: receivingCashierId,
    };
    const staffShiftFind = vi
      .fn()
      .mockResolvedValueOnce(openShift)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(handedOver);
    const client = {
      staffShift: {
        findFirst: staffShiftFind,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: receivingCashierId,
          roles: [
            {
              branchId,
              role: {
                scope: "BRANCH",
                permissions: [{ permissionKey: "shifts.open" }],
              },
            },
          ],
        }),
      },
      shiftResponsibility: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;

    await expect(
      new ShiftsService(prisma, hours()).handover(
        shiftId,
        {
          branchId,
          revision: 1,
          receivingCashierId,
          reason: "Scheduled change",
        },
        "shift-handover-success",
        principal(["shifts.manage"]),
      ),
    ).resolves.toMatchObject({
      revision: 2,
      currentCashierId: receivingCashierId,
    });
    expect(client.shiftResponsibility.updateMany).toHaveBeenCalledOnce();
    expect(client.shiftResponsibility.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cashierId: receivingCashierId }),
    });
  });

  it("closes a balanced shift with an immutable count snapshot", async () => {
    const openShift = {
      id: shiftId,
      branchId,
      status: "OPEN",
      revision: 1,
      currentCashierId: userId,
      openingFloatMinor: 10_000,
    };
    const closedShift = {
      ...openShift,
      status: "CLOSED",
      revision: 2,
      close: {
        countedCashMinor: 11_700,
        expectedCashMinor: 11_700,
        varianceMinor: 0,
      },
    };
    const client = {
      staffShift: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(openShift)
          .mockResolvedValueOnce(closedShift),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 2_000 } }),
      },
      refund: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 500 } }),
      },
      cashMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([
          { direction: "IN", _sum: { amountMinor: 300 } },
          { direction: "OUT", _sum: { amountMinor: 100 } },
        ]),
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      shiftResponsibility: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      shiftClose: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;

    await expect(
      new ShiftsService(prisma, hours()).close(
        shiftId,
        {
          branchId,
          revision: 1,
          countedCashMinor: 11_700,
          declaration: "Counted twice",
          reason: "End service",
        },
        "shift-close-balanced",
        principal(["shifts.close"]),
      ),
    ).resolves.toMatchObject({ status: "CLOSED", revision: 2 });
    expect(client.shiftClose.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        countedCashMinor: 11_700,
        expectedCashMinor: 11_700,
        varianceMinor: 0,
        approvedById: null,
      }),
    });
  });

  it("replays identical opens and rejects conflicting key reuse", async () => {
    const replay = { id: shiftId, status: "OPEN" };
    const prisma = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: requestHash(openInput),
          responseBody: replay,
        }),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma, hours());

    await expect(
      service.open(openInput, "shift-open-replay", principal(["shifts.open"])),
    ).resolves.toEqual(replay);
    await expect(
      service.open(
        { ...openInput, openingFloatMinor: 20_000 },
        "shift-open-replay",
        principal(["shifts.open"]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
