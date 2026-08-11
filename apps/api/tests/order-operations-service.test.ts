import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { OrderOperationsService } from "../src/orders/order-operations.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const orderId = "10000000-0000-4000-8000-000000000005";
const secondOrderId = "10000000-0000-4000-8000-000000000006";

function principal(permissions: readonly string[]): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId,
    displayName: "Manager",
    email: "manager@example.test",
    mustChangePassword: false,
    assignments: [{ scope: "BRANCH", branchId, permissions }],
  };
}

function transactional(client: object) {
  return {
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
      work(client),
    ),
  } as unknown as PrismaService;
}

function activeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    branchId,
    shiftId: "10000000-0000-4000-8000-000000000010",
    deviceId,
    assignedServerId: userId,
    revision: 1,
    status: "OPEN",
    channel: "BAR_TAB",
    businessDate: new Date("2026-08-07T00:00:00Z"),
    currency: "GHS",
    taxProfileId: "10000000-0000-4000-8000-000000000011",
    tableId: null,
    shift: { status: "OPEN" },
    ...overrides,
  };
}

describe("order table, transfer, merge, and split controls", () => {
  it("lists only active branch-visible transfer recipients", async () => {
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: userId, displayName: "Manager" }]),
      },
    } as unknown as PrismaService;
    const result = await new OrderOperationsService(prisma).options(
      branchId,
      principal(["orders.owner.transfer"]),
    );
    expect(result.staff).toEqual([{ id: userId, displayName: "Manager" }]);
    expect(
      (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({
      where: {
        organizationId,
        status: "ACTIVE",
        roles: { some: { revokedAt: null } },
      },
    });
  });

  it("blocks an occupied move unless an explicit manager override is supplied", async () => {
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue(activeOrder()),
        findMany: vi.fn().mockResolvedValue([{ id: secondOrderId }]),
      },
      diningTable: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "10000000-0000-4000-8000-000000000020" }),
      },
    };
    const failure = await new OrderOperationsService(transactional(client))
      .moveTable(
        orderId,
        {
          operationId: "10000000-0000-4000-8000-000000000021",
          branchId,
          revision: 1,
          tableId: "10000000-0000-4000-8000-000000000020",
          allowTableConflict: false,
          reason: "Move service table",
        },
        "order-table-move-0001",
        principal(["orders.table.move"]),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "TABLE_OCCUPIED",
    });
  });

  it("rejects merge candidates with different channels", async () => {
    const client = {
      order: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(activeOrder())
          .mockResolvedValueOnce(
            activeOrder({ id: secondOrderId, channel: "DINE_IN" }),
          ),
      },
      orderMerge: { count: vi.fn().mockResolvedValue(0) },
    };
    const failure = await new OrderOperationsService(transactional(client))
      .merge(
        orderId,
        {
          mergeId: "10000000-0000-4000-8000-000000000022",
          branchId,
          targetRevision: 1,
          sourceOrderId: secondOrderId,
          sourceRevision: 1,
          reason: "Join compatible tabs",
        },
        "order-merge-key-0001",
        principal(["orders.split-merge"]),
      )
      .catch((error: unknown) => error);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "ORDER_MERGE_INCOMPATIBLE",
    });
  });

  it("never permits a sent snapshot to move through a split", async () => {
    const lineId = "10000000-0000-4000-8000-000000000030";
    const client = {
      order: { findFirst: vi.fn().mockResolvedValue(activeOrder()) },
      orderMerge: { count: vi.fn().mockResolvedValue(0) },
      orderLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: lineId,
            orderId,
            status: "DRAFT",
            quantity: 2,
            sentAt: new Date(),
            sentCancelledAt: null,
            modifiers: [],
          },
        ]),
      },
    };
    const failure = await new OrderOperationsService(transactional(client))
      .split(
        orderId,
        {
          splitId: "10000000-0000-4000-8000-000000000031",
          branchId,
          sourceRevision: 1,
          newOrderId: "10000000-0000-4000-8000-000000000032",
          newClientReference: "offline-split-child-1",
          allowTableConflict: false,
          lines: [
            {
              sourceLineId: lineId,
              targetLineId: "10000000-0000-4000-8000-000000000033",
              quantity: 2,
            },
          ],
          reason: "Split guest check",
        },
        "order-split-key-0001",
        principal(["orders.split-merge"]),
      )
      .catch((error: unknown) => error);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "SENT_LINE_IMMUTABLE",
    });
  });

  it("commits a table move with lineage, audit, outbox, and idempotency", async () => {
    const targetTableId = "10000000-0000-4000-8000-000000000040";
    const movementId = "10000000-0000-4000-8000-000000000041";
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue(activeOrder()),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      diningTable: {
        findFirst: vi.fn().mockResolvedValue({ id: targetTableId }),
      },
      orderTableMovement: {
        create: vi.fn().mockResolvedValue({ id: movementId }),
      },
      orderEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await new OrderOperationsService(
      transactional(client),
    ).moveTable(
      orderId,
      {
        operationId: movementId,
        branchId,
        revision: 1,
        tableId: targetTableId,
        allowTableConflict: false,
        reason: "Move to patio table",
      },
      "order-table-move-0002",
      principal(["orders.table.move"]),
    );
    expect(result).toMatchObject({
      orderId,
      revision: 2,
      tableId: targetTableId,
      movementId,
    });
    expect(client.orderTableMovement.create).toHaveBeenCalledOnce();
    expect(client.orderEvent.create).toHaveBeenCalledOnce();
    expect(client.auditLog.create).toHaveBeenCalledOnce();
    expect(client.outboxEvent.createMany).toHaveBeenCalledOnce();
    expect(client.idempotencyRecord.create).toHaveBeenCalledOnce();
  });
});
