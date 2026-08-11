import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { BranchHoursService } from "../src/branch-hours/branch-hours.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { ShiftsService } from "../src/shifts/shifts.service.js";

describe("shift close order guard", () => {
  it("blocks close while the shift has an open or held order", async () => {
    const branchId = "10000000-0000-4000-8000-000000000001";
    const userId = "10000000-0000-4000-8000-000000000002";
    const deviceId = "10000000-0000-4000-8000-000000000003";
    const shiftId = "10000000-0000-4000-8000-000000000004";
    const client = {
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({
          id: shiftId,
          branchId,
          currentCashierId: userId,
          openingFloatMinor: 1000,
          status: "OPEN",
          revision: 1,
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
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "10000000-0000-4000-8000-000000000005",
            orderNumber: "20260806-0001",
          },
        ]),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;
    const principal: AuthPrincipal = {
      userId,
      organizationId: "10000000-0000-4000-8000-000000000006",
      deviceId,
      displayName: "Cashier",
      email: "cashier@example.test",
      mustChangePassword: false,
      assignments: [
        { scope: "BRANCH", branchId, permissions: ["shifts.close"] },
      ],
    };
    const error = await new ShiftsService(prisma, {} as BranchHoursService)
      .close(
        shiftId,
        {
          branchId,
          revision: 1,
          countedCashMinor: 1000,
          declaration: "Count complete",
          reason: "End shift",
        },
        "shift-close-order-guard",
        principal,
      )
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "SHIFT_OPEN_ORDERS",
      orderCount: 1,
    });
  });
});
