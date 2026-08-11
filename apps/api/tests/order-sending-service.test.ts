import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { OrderSendingService } from "../src/orders/order-sending.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const orderId = "10000000-0000-4000-8000-000000000005";
const lineId = "10000000-0000-4000-8000-000000000006";
const sendWaveId = "10000000-0000-4000-8000-000000000007";

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

const input = {
  branchId,
  orderRevision: 1,
  sendWaveId,
  lineIds: [lineId],
  reason: "Send first round",
};

function prismaWithTransaction(client: object) {
  return {
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
      work(client),
    ),
  } as unknown as PrismaService;
}

describe("order sending service", () => {
  it("requires orders.send before persistence", async () => {
    const prisma = prismaWithTransaction({});
    await expect(
      new OrderSendingService(prisma).send(
        orderId,
        input,
        "send-wave-key-0001",
        principal([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a send after cashier handover", async () => {
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          branchId,
          revision: 1,
          status: "OPEN",
          deviceId,
          shift: {
            status: "OPEN",
            deviceId,
            currentCashierId: "10000000-0000-4000-8000-000000000099",
          },
          lines: [],
        }),
      },
    };
    const error = await new OrderSendingService(prismaWithTransaction(client))
      .send(orderId, input, "send-wave-key-0002", principal(["orders.send"]))
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "ORDER_STATE_INVALID",
    });
  });

  it("rejects a selected line without a station snapshot", async () => {
    const client = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          branchId,
          revision: 1,
          status: "OPEN",
          deviceId,
          shift: { status: "OPEN", deviceId, currentCashierId: userId },
          lines: [
            {
              id: lineId,
              status: "DRAFT",
              sentAt: null,
              sentCancelledAt: null,
              stationId: null,
              stationNameSnapshot: null,
              quantity: 1,
              itemNameSnapshot: "Unrouted",
              variantNameSnapshot: null,
              note: null,
              modifiers: [],
            },
          ],
        }),
      },
    };
    const error = await new OrderSendingService(prismaWithTransaction(client))
      .send(orderId, input, "send-wave-key-0003", principal(["orders.send"]))
      .catch((failure: unknown) => failure);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "PREPARATION_STATION_MISSING",
    });
  });

  it("replays an identical send without creating duplicate tickets", async () => {
    const response = { sendWaveId, orderRevision: 2 };
    const prisma = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash:
            "4fd63d3a0ae6feca649331d8a58df2a58e557351cf3eab72c7a30504481d7421",
          responseBody: response,
        }),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    // Use the real hash so this test also locks the offline command shape.
    const { requestHash } = await import("../src/common/request-hash.js");
    prisma.idempotencyRecord.findUnique = vi.fn().mockResolvedValue({
      requestHash: requestHash({ orderId, ...input }),
      responseBody: response,
    });
    await expect(
      new OrderSendingService(prisma).send(
        orderId,
        input,
        "send-wave-key-0004",
        principal(["orders.send"]),
      ),
    ).resolves.toEqual(response);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires orders.manage for a sent-line cancellation", async () => {
    const prisma = prismaWithTransaction({});
    await expect(
      new OrderSendingService(prisma).cancelSentLine(
        orderId,
        lineId,
        {
          branchId,
          orderRevision: 2,
          cancellationId: "10000000-0000-4000-8000-000000000008",
          reason: "Customer cancelled after send",
        },
        "sent-cancel-key-0001",
        principal(["orders.write"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
