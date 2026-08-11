import { describe, expect, it } from "vitest";
import {
  dailySummaryResponseSchema,
  reportExceptionQuerySchema,
  reportExceptionsResponseSchema,
  reportExportDatasetSchema,
  reportRangeQuerySchema,
  salesBreakdownQuerySchema,
  shiftReconciliationResponseSchema,
} from "../src/index.js";

describe("report contracts", () => {
  it("accepts an inclusive 31-day range", () => {
    expect(
      reportRangeQuerySchema.safeParse({
        fromDate: "2026-08-01",
        toDate: "2026-08-31",
      }).success,
    ).toBe(true);
  });

  it("rejects reversed and longer synchronous ranges", () => {
    expect(
      reportRangeQuerySchema.safeParse({
        fromDate: "2026-08-02",
        toDate: "2026-08-01",
      }).success,
    ).toBe(false);
    expect(
      reportRangeQuerySchema.safeParse({
        fromDate: "2026-08-01",
        toDate: "2026-09-01",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit supported sales grouping", () => {
    expect(
      salesBreakdownQuerySchema.parse({
        fromDate: "2026-08-07",
        toDate: "2026-08-07",
        groupBy: "CATEGORY",
      }).groupBy,
    ).toBe("CATEGORY");
  });

  it("bounds exception pages and export datasets", () => {
    expect(
      reportExceptionQuerySchema.safeParse({
        fromDate: "2026-08-07",
        toDate: "2026-08-07",
        limit: 101,
      }).success,
    ).toBe(false);
    expect(reportExportDatasetSchema.safeParse("CUSTOMERS").success).toBe(
      false,
    );
  });

  it("validates stable UI report projections with checked integer money", () => {
    const metadata = {
      branchId: "10000000-0000-4000-8000-000000000001",
      fromDate: "2026-08-09",
      toDate: "2026-08-09",
      timezone: "Africa/Accra",
      currency: "GHS",
      generatedAt: "2026-08-09T12:00:00.000Z",
      basis: ["ORDER_BUSINESS_DATE"],
      unavailableMetrics: ["DISCOUNTS"],
    };
    expect(
      dailySummaryResponseSchema.parse({
        metadata,
        rows: [
          {
            businessDate: "2026-08-09",
            completedOrderCount: 1,
            inputSubtotalMinor: 1_000,
            netTotalMinor: 900,
            taxTotalMinor: 100,
            grossTotalMinor: 1_000,
            grossSalesMinor: 1_000,
            confirmedRefundCount: 1,
            confirmedRefundsMinor: 200,
            commercialNetAfterRefundsMinor: 800,
          },
        ],
      }).rows[0]?.grossSalesMinor,
    ).toBe(1_000);
    expect(() =>
      dailySummaryResponseSchema.parse({
        metadata,
        rows: [
          {
            businessDate: "2026-08-09",
            completedOrderCount: 0,
            inputSubtotalMinor: Number.MAX_SAFE_INTEGER + 1,
            netTotalMinor: 0,
            taxTotalMinor: 0,
            grossTotalMinor: 0,
            grossSalesMinor: 0,
            confirmedRefundCount: 0,
            confirmedRefundsMinor: 0,
            commercialNetAfterRefundsMinor: 0,
          },
        ],
      }),
    ).toThrow();
  });

  it("validates shift and exception states consumed by management UI", () => {
    const metadata = {
      branchId: "10000000-0000-4000-8000-000000000001",
      fromDate: "2026-08-09",
      toDate: "2026-08-09",
      timezone: "Africa/Accra",
      currency: "GHS",
      generatedAt: "2026-08-09T12:00:00.000Z",
      unavailableMetrics: [],
    };
    expect(
      shiftReconciliationResponseSchema.parse({
        metadata: { ...metadata, basis: ["SHIFT_BUSINESS_DATE"] },
        rows: [
          {
            shiftId: "10000000-0000-4000-8000-000000000010",
            businessDate: "2026-08-09",
            shiftStatus: "CLOSED",
            openingFloatMinor: 100,
            confirmedCashPaymentsMinor: 200,
            confirmedCashRefundsMinor: 0,
            postedCashInMinor: 0,
            postedCashOutMinor: 0,
            recomputedExpectedCashMinor: 300,
            storedExpectedCashMinor: 300,
            countedCashMinor: 300,
            varianceMinor: 0,
            reconciliationStatus: "MATCH",
            closedAt: "2026-08-09T20:00:00.000Z",
          },
        ],
      }).rows[0]?.reconciliationStatus,
    ).toBe("MATCH");
    expect(
      reportExceptionsResponseSchema.parse({
        metadata: {
          ...metadata,
          basis: ["EXCEPTION_ACTIVITY_LOCAL_DATE"],
        },
        rows: [
          {
            id: "10000000-0000-4000-8000-000000000020",
            type: "SHIFT_VARIANCE",
            occurredAt: "2026-08-09T20:00:00.000Z",
            activityDate: "2026-08-09",
            status: "CLOSED",
            amountMinor: -50,
            reference: "10000000-0000-4000-8000-000000000010",
          },
        ],
        nextCursor: null,
      }).rows,
    ).toHaveLength(1);
  });
});
