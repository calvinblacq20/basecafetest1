import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { OrdersService } from "../src/orders/orders.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const orderId = "10000000-0000-4000-8000-000000000005";
const shiftId = "10000000-0000-4000-8000-000000000006";

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

const createInput = {
  orderId,
  branchId,
  shiftId,
  clientReference: "offline-order-0001",
  channel: "DINE_IN" as const,
  allowTableConflict: false,
  reason: "Open counter order",
};

function transactional(client: object, additions: object = {}) {
  return {
    order: { findFirst: vi.fn().mockResolvedValue(null) },
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
      work(client),
    ),
    ...additions,
  } as unknown as PrismaService;
}

describe("orders service controls", () => {
  it("rejects a closed or wrong-device shift with a stable code", async () => {
    const client = {
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({
          id: shiftId,
          branchId,
          deviceId,
          currentCashierId: userId,
          status: "CLOSED",
        }),
      },
    };
    const service = new OrdersService(transactional(client));
    const failure = await service
      .create(
        createInput,
        "order-create-key-0001",
        principal(["orders.create"]),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "ORDER_SHIFT_NOT_OPEN",
    });
  });

  it("requires orders.manage for an occupied table override", async () => {
    const tableId = "10000000-0000-4000-8000-000000000007";
    const client = {
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({
          id: shiftId,
          businessDate: new Date("2026-08-06T00:00:00Z"),
          currency: "GHS",
          deviceId,
          currentCashierId: userId,
          status: "OPEN",
        }),
      },
      diningTable: { findFirst: vi.fn().mockResolvedValue({ id: tableId }) },
      order: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "10000000-0000-4000-8000-000000000099" }]),
      },
    };
    const service = new OrdersService(transactional(client));
    await expect(
      service.create(
        { ...createInput, tableId, allowTableConflict: true },
        "order-create-key-0002",
        principal(["orders.create"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns a stable PII-free order-list projection", async () => {
    const order = {
      id: orderId,
      orderNumber: "20260809-0001",
      clientReference: "POS-TEST-1",
      channel: "DINE_IN",
      status: "OPEN",
      revision: 2,
      businessDate: new Date("2026-08-09T00:00:00.000Z"),
      createdAt: new Date("2026-08-09T10:00:00.000Z"),
      updatedAt: new Date("2026-08-09T10:01:00.000Z"),
      table: null,
      assignedServer: { id: userId, displayName: "Cashier" },
      guestCount: null,
      pickupReference: null,
      customerReference: null,
      tabName: null,
      grossTotalMinor: 2400,
      _count: { lines: 1 },
      customerPhone: "0200000000",
      deliveryDirections: "Second gate",
    };
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
    } as unknown as PrismaService;
    const result = await new OrdersService(prisma).list(
      branchId,
      { limit: 50 },
      principal(["orders.read"]),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: orderId,
        businessDate: "2026-08-09",
        activeLineCount: 1,
        grossTotalMinor: 2400,
      }),
    ]);
    expect(result[0]).not.toHaveProperty("customerPhone");
    expect(result[0]).not.toHaveProperty("deliveryDirections");
  });

  it("blocks the first line when no approved active tax profile is effective", async () => {
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          branchId,
          currency: "GHS",
          deviceId,
          revision: 1,
          status: "OPEN",
          taxProfileId: null,
        }),
      },
      taxProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new OrdersService(transactional(client));
    const failure = await service
      .addLine(
        orderId,
        {
          branchId,
          orderRevision: 1,
          lineId: "10000000-0000-4000-8000-000000000008",
          menuItemId: "10000000-0000-4000-8000-000000000009",
          quantity: 1,
          modifiers: [],
          reason: "Add item",
        },
        "order-line-key-0001",
        principal(["orders.write"]),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "TAX_CONFIGURATION_MISSING",
    });
  });
});
