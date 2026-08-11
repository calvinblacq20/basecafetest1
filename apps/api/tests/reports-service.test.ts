import {
  dailySummaryResponseSchema,
  salesBreakdownResponseSchema,
  shiftReconciliationResponseSchema,
} from "@base-cafe/contracts";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { ReportsService } from "../src/reports/reports.service.js";

const branchId = "10000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000002";
const principal = (permission: string): AuthPrincipal => ({
  userId: "10000000-0000-4000-8000-000000000003",
  organizationId: "10000000-0000-4000-8000-000000000004",
  deviceId: "10000000-0000-4000-8000-000000000005",
  displayName: "Accountant",
  email: "accountant@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions: [permission] }],
});

const line = {
  id: "10000000-0000-4000-8000-000000000006",
  menuItemId: "10000000-0000-4000-8000-000000000007",
  variantId: null,
  status: "DRAFT",
  quantity: 1,
  itemNameSnapshot: "Jollof",
  itemSkuSnapshot: "FOOD-1",
  categoryKeySnapshot: "FOOD",
  categoryNameSnapshot: "Food",
  variantNameSnapshot: null,
  taxTreatmentSnapshot: "STANDARD",
  lineInputAmountMinor: 1000,
  netAmountMinor: 900,
  taxTotalMinor: 100,
  grossAmountMinor: 1000,
  taxComponents: [
    {
      codeSnapshot: "VAT",
      receiptLabelSnapshot: "VAT",
      ratePpmSnapshot: 100_000,
      taxableBaseMinor: 900,
      amountMinor: 100,
      roundingAdjustmentMinor: 0,
    },
  ],
};

function transaction() {
  return {
    branch: {
      findFirst: vi.fn().mockResolvedValue({
        id: branchId,
        timezone: "Africa/Accra",
        currency: "GHS",
      }),
    },
    order: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: orderId,
          orderNumber: "20260807-0001",
          businessDate: new Date("2026-08-07T00:00:00.000Z"),
          channel: "DINE_IN",
          completedAt: new Date("2026-08-07T18:00:00.000Z"),
          inputSubtotalMinor: 1000,
          netTotalMinor: 900,
          taxTotalMinor: 100,
          grossTotalMinor: 1000,
          lines: [line],
          mergesAsTarget: [
            {
              source: {
                id: "10000000-0000-4000-8000-000000000008",
                orderNumber: "20260807-0002",
                inputSubtotalMinor: 500,
                netTotalMinor: 450,
                taxTotalMinor: 50,
                grossTotalMinor: 500,
                lines: [],
              },
            },
          ],
        },
      ]),
    },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    refund: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "10000000-0000-4000-8000-000000000009",
          orderId,
          kind: "REFUND",
          amountMinor: 200,
          confirmedAt: new Date("2026-08-07T20:00:00.000Z"),
          payment: { method: "CASH" },
        },
      ]),
    },
    staffShift: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function prisma(client: ReturnType<typeof transaction>) {
  return {
    $transaction: vi.fn((work: (tx: object) => unknown) => work(client)),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

describe("reports service", () => {
  it("counts a completed merge composition once and keeps refunds separate", async () => {
    const service = new ReportsService(prisma(transaction()));
    const report = await service.dailySummary(
      branchId,
      { fromDate: "2026-08-07", toDate: "2026-08-07" },
      principal("reports.read"),
    );
    expect(report.rows[0]).toMatchObject({
      completedOrderCount: 1,
      grossSalesMinor: 1500,
      confirmedRefundsMinor: 200,
      commercialNetAfterRefundsMinor: 1300,
    });
    expect(dailySummaryResponseSchema.parse(report).rows).toHaveLength(1);
  });

  it("groups immutable category snapshots without catalog lookups", async () => {
    const client = transaction();
    const report = await new ReportsService(prisma(client)).salesBreakdown(
      branchId,
      {
        fromDate: "2026-08-07",
        toDate: "2026-08-07",
        groupBy: "CATEGORY",
      },
      principal("reports.read"),
    );
    expect(report.rows).toEqual([
      expect.objectContaining({
        key: "FOOD",
        label: "Food",
        orderCount: 1,
        grossTotalMinor: 1000,
      }),
    ]);
    expect(salesBreakdownResponseSchema.parse(report).groupBy).toBe("CATEGORY");
  });

  it("audits deterministic CSV exports without customer data", async () => {
    const client = transaction();
    const database = prisma(client);
    const result = await new ReportsService(database).export(
      branchId,
      "DAILY_SUMMARY",
      { fromDate: "2026-08-07", toDate: "2026-08-07" },
      principal("reports.export"),
    );
    expect(result.content).toContain("gross_sales_minor");
    expect(result.content).not.toContain("customerPhone");
    expect(database.auditLog.create).toHaveBeenCalledOnce();
  });

  it("recomputes drawer cash and detects a stored close mismatch", async () => {
    const client = transaction();
    client.staffShift.findMany.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000010",
        businessDate: new Date("2026-08-07T00:00:00.000Z"),
        status: "CLOSED",
        currency: "GHS",
        openingFloatMinor: 10_000,
        close: {
          expectedCashMinor: 11_600,
          countedCashMinor: 11_550,
          varianceMinor: -50,
          closedAt: new Date("2026-08-07T23:00:00.000Z"),
        },
        payments: [{ amountMinor: 2_000 }],
        refunds: [{ amountMinor: 500 }],
        cashMovements: [
          { direction: "IN", amountMinor: 300 },
          { direction: "OUT", amountMinor: 100 },
        ],
      },
    ]);
    const report = await new ReportsService(prisma(client)).shiftReconciliation(
      branchId,
      { fromDate: "2026-08-07", toDate: "2026-08-07" },
      principal("reports.read"),
    );
    expect(report.rows[0]).toMatchObject({
      recomputedExpectedCashMinor: 11_700,
      storedExpectedCashMinor: 11_600,
      reconciliationStatus: "MISMATCH",
    });
    expect(
      shiftReconciliationResponseSchema.parse(report).rows[0]
        ?.reconciliationStatus,
    ).toBe("MISMATCH");
  });

  it("denies report reads before touching persistence", async () => {
    const database = prisma(transaction());
    await expect(
      new ReportsService(database).dailySummary(
        branchId,
        { fromDate: "2026-08-07", toDate: "2026-08-07" },
        principal("reports.export"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
