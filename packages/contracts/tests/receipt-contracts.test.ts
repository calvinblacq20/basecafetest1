import { describe, expect, it } from "vitest";
import {
  createReceiptRequestSchema,
  receiptDetailResponseSchema,
  receiptHistoryListResponseSchema,
  receiptResponseSchema,
  reprintReceiptRequestSchema,
  updatePrintJobRequestSchema,
} from "../src/index.js";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
describe("receipt contracts", () => {
  it("parses the commercial receipt response consumed by the POS", () =>
    expect(
      receiptResponseSchema.parse({
        id: id(1),
        branchId: id(2),
        orderId: id(3),
        receiptNumber: "R-20260809-0001",
        currency: "GHS",
        renderedHtml: "<html><body>NOT A FISCAL RECEIPT</body></html>",
        fiscalDocument: { id: id(4), status: "NOT_REQUIRED" },
      }).fiscalDocument.status,
    ).toBe("NOT_REQUIRED"));
  it("requires client IDs and order revision", () =>
    expect(
      createReceiptRequestSchema.parse({
        receiptId: id(1),
        fiscalDocumentId: id(2),
        branchId: id(3),
        orderRevision: 2,
        reason: "Issue commercial receipt",
      }).orderRevision,
    ).toBe(2));
  it("bounds reprint copies", () =>
    expect(
      reprintReceiptRequestSchema.safeParse({
        reprintId: id(1),
        printJobId: id(2),
        branchId: id(3),
        copies: 6,
        reason: "Customer copy",
      }).success,
    ).toBe(false));
  it("requires a failure code for operational input validation", () =>
    expect(
      updatePrintJobRequestSchema.parse({
        branchId: id(1),
        revision: 1,
        status: "FAILED",
        errorCode: "OFFLINE",
        reason: "Printer unavailable",
      }).status,
    ).toBe("FAILED"));

  it("parses the PII-safe receipt and print-job history", () => {
    const printJob = {
      id: id(5),
      receiptId: id(1),
      status: "FAILED" as const,
      revision: 2,
      copies: 1,
      attemptCount: 1,
      targetPrinter: null,
      errorCode: "BROWSER_PRINT_CANCELLED",
      printedAt: null,
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:01:00.000Z",
    };
    const item = {
      id: id(1),
      branchId: id(2),
      orderId: id(3),
      orderNumber: "20260809-0001",
      receiptNumber: "R-20260809-0001",
      businessDate: "2026-08-09",
      currency: "GHS",
      totalMinor: 1200,
      fiscalStatus: "NOT_REQUIRED" as const,
      reprintCount: 1,
      latestPrintJob: printJob,
      createdAt: "2026-08-09T10:00:00.000Z",
    };

    expect(
      receiptHistoryListResponseSchema.parse({
        generatedAt: "2026-08-09T10:02:00.000Z",
        items: [item],
      }).items[0]?.latestPrintJob?.status,
    ).toBe("FAILED");
    expect(
      receiptDetailResponseSchema.parse({
        ...item,
        reprints: [
          {
            id: id(6),
            copies: 1,
            createdAt: "2026-08-09T10:00:30.000Z",
          },
        ],
        printJobs: [printJob],
      }).reprints,
    ).toHaveLength(1);
  });
});
