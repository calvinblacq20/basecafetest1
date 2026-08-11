import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { ReceiptsService } from "../src/receipts/receipts.service.js";

const branchId = "10000000-0000-4000-8000-000000000001";
const receiptId = "10000000-0000-4000-8000-000000000002";
const orderId = "10000000-0000-4000-8000-000000000003";
const printJobId = "10000000-0000-4000-8000-000000000004";

const principal = (permissions: string[]): AuthPrincipal => ({
  userId: "10000000-0000-4000-8000-000000000005",
  organizationId: "10000000-0000-4000-8000-000000000006",
  deviceId: "10000000-0000-4000-8000-000000000007",
  displayName: "Cashier",
  email: "cashier@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});

describe("ReceiptsService history", () => {
  it("returns a stable PII-safe receipt and latest print projection", async () => {
    const createdAt = new Date("2026-08-09T10:00:00.000Z");
    const printJob = {
      id: printJobId,
      receiptId,
      status: "FAILED",
      revision: 2,
      copies: 1,
      attemptCount: 1,
      targetPrinter: null,
      errorCode: "PRINTER_OFFLINE",
      printedAt: null,
      createdAt,
      updatedAt: new Date("2026-08-09T10:01:00.000Z"),
    };
    const findMany = vi.fn().mockResolvedValue([
      {
        id: receiptId,
        branchId,
        orderId,
        receiptNumber: "R-20260809-0001",
        businessDate: new Date("2026-08-09T00:00:00.000Z"),
        currency: "GHS",
        snapshot: { totalMinor: 1200, phone: "must-not-project" },
        createdAt,
        order: { orderNumber: "20260809-0001" },
        fiscalDocument: { status: "NOT_REQUIRED" },
        _count: { reprints: 1 },
        printJobs: [printJob],
      },
    ]);
    const service = new ReceiptsService({ receipt: { findMany } } as never);

    const response = await service.list(
      branchId,
      { search: "R-2026", limit: 20 },
      principal(["receipts.read"]),
    );

    expect(response.items[0]).toMatchObject({
      receiptNumber: "R-20260809-0001",
      orderNumber: "20260809-0001",
      totalMinor: 1200,
      reprintCount: 1,
      latestPrintJob: { status: "FAILED", errorCode: "PRINTER_OFFLINE" },
    });
    expect(JSON.stringify(response)).not.toContain("must-not-project");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId,
          branch: { organizationId: principal([]).organizationId },
        }),
        take: 20,
      }),
    );
  });

  it("enforces branch receipt-read permission before querying", async () => {
    const findMany = vi.fn();
    const service = new ReceiptsService({ receipt: { findMany } } as never);
    await expect(
      service.list(branchId, { limit: 50 }, principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not retry a print job unless it is failed", async () => {
    const update = vi.fn();
    const transaction = {
      printJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: printJobId,
          branchId,
          receiptId,
          revision: 1,
          status: "PRINTED",
        }),
        update,
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new ReceiptsService(prisma as never);

    await expect(
      service.updatePrintJob(
        printJobId,
        { branchId, revision: 1, reason: "Retry after printer check" },
        "print-job-retry-0001",
        principal(["print-jobs.manage"]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });
});
