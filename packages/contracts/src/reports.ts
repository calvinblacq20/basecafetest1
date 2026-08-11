import { z } from "zod";

import { paymentMethodSchema } from "./payments.js";
import { taxTreatmentSchema } from "./tax.js";

const date = z.string().date();

function inclusiveDays(fromDate: string, toDate: string) {
  return (
    Math.floor(
      (Date.parse(`${toDate}T00:00:00.000Z`) -
        Date.parse(`${fromDate}T00:00:00.000Z`)) /
        86_400_000,
    ) + 1
  );
}

function rangeSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ fromDate: date, toDate: date, ...shape })
    .superRefine((value, context) => {
      const range = value as { fromDate: string; toDate: string };
      const days = inclusiveDays(range.fromDate, range.toDate);
      if (days < 1) {
        context.addIssue({
          code: "custom",
          path: ["toDate"],
          message: "toDate must be on or after fromDate.",
        });
      } else if (days > 31) {
        context.addIssue({
          code: "custom",
          path: ["toDate"],
          message: "Report ranges may contain at most 31 inclusive days.",
        });
      }
    });
}

export const reportRangeQuerySchema = rangeSchema({});
export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

export const salesReportGroupingSchema = z.enum([
  "CHANNEL",
  "ITEM",
  "CATEGORY",
  "COMPLETION_HOUR",
]);
export type SalesReportGrouping = z.infer<typeof salesReportGroupingSchema>;

export const salesBreakdownQuerySchema = rangeSchema({
  groupBy: salesReportGroupingSchema,
});
export type SalesBreakdownQuery = z.infer<typeof salesBreakdownQuerySchema>;

export const reportExceptionTypeSchema = z.enum([
  "ORDER_CANCELLED",
  "SENT_LINE_CANCELLED",
  "TABLE_CONFLICT_OVERRIDDEN",
  "PAYMENT_UNRESOLVED",
  "PAYMENT_FAILED",
  "REFUND_UNRESOLVED",
  "REFUND_FAILED",
  "CASH_MOVEMENT_PENDING",
  "CASH_MOVEMENT_REJECTED",
  "CASH_MOVEMENT_CORRECTION",
  "SHIFT_VARIANCE",
]);
export type ReportExceptionType = z.infer<typeof reportExceptionTypeSchema>;

export const reportExceptionQuerySchema = rangeSchema({
  type: reportExceptionTypeSchema.optional(),
  cursor: z.string().trim().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReportExceptionQuery = z.infer<typeof reportExceptionQuerySchema>;

export const reportExportDatasetSchema = z.enum([
  "DAILY_SUMMARY",
  "SALES_LINES",
  "TENDERS",
  "TAX_COMPONENTS",
  "SHIFT_RECONCILIATION",
  "REFUNDS",
  "EXCEPTIONS",
]);
export type ReportExportDataset = z.infer<typeof reportExportDatasetSchema>;

export const reportBasisSchema = z.enum([
  "ORDER_BUSINESS_DATE",
  "PAYMENT_CONFIRMATION_LOCAL_DATE",
  "REFUND_CONFIRMATION_LOCAL_DATE",
  "SHIFT_BUSINESS_DATE",
  "EXCEPTION_ACTIVITY_LOCAL_DATE",
]);

export const reportMetadataSchema = z.object({
  branchId: z.string().uuid(),
  fromDate: date,
  toDate: date,
  timezone: z.string().min(1).max(64),
  currency: z.string().length(3),
  generatedAt: z.string().datetime(),
  basis: z.array(reportBasisSchema).min(1),
  unavailableMetrics: z.array(z.string()),
});
export type ReportMetadata = z.infer<typeof reportMetadataSchema>;

const safeInteger = z.number().int().safe();
const nonNegativeSafeInteger = safeInteger.nonnegative();

export const reportMoneyTotalsSchema = z.object({
  inputSubtotalMinor: nonNegativeSafeInteger,
  netTotalMinor: nonNegativeSafeInteger,
  taxTotalMinor: nonNegativeSafeInteger,
  grossTotalMinor: nonNegativeSafeInteger,
});

export const dailySummaryRowSchema = reportMoneyTotalsSchema.extend({
  businessDate: date,
  completedOrderCount: nonNegativeSafeInteger,
  grossSalesMinor: nonNegativeSafeInteger,
  confirmedRefundCount: nonNegativeSafeInteger,
  confirmedRefundsMinor: nonNegativeSafeInteger,
  commercialNetAfterRefundsMinor: safeInteger,
});

export const dailySummaryResponseSchema = z.object({
  metadata: reportMetadataSchema,
  rows: z.array(dailySummaryRowSchema),
});
export type DailySummaryResponse = z.infer<typeof dailySummaryResponseSchema>;

export const salesBreakdownRowSchema = reportMoneyTotalsSchema.extend({
  key: z.string().min(1),
  label: z.string().min(1),
  lineCount: nonNegativeSafeInteger,
  quantity: nonNegativeSafeInteger,
  orderCount: nonNegativeSafeInteger,
});

export const salesBreakdownResponseSchema = z.object({
  metadata: reportMetadataSchema,
  groupBy: salesReportGroupingSchema,
  rows: z.array(salesBreakdownRowSchema),
});
export type SalesBreakdownResponse = z.infer<
  typeof salesBreakdownResponseSchema
>;

export const tenderSummaryRowSchema = z.object({
  activityDate: date,
  method: paymentMethodSchema,
  paymentCount: nonNegativeSafeInteger,
  confirmedMinor: nonNegativeSafeInteger,
  refundCount: nonNegativeSafeInteger,
  refundedMinor: nonNegativeSafeInteger,
  netMinor: safeInteger,
});

export const tenderSummaryResponseSchema = z.object({
  metadata: reportMetadataSchema,
  rows: z.array(tenderSummaryRowSchema),
});
export type TenderSummaryResponse = z.infer<typeof tenderSummaryResponseSchema>;

export const taxSummaryRowSchema = z.object({
  businessDate: date,
  code: z.string().min(1),
  label: z.string().min(1),
  ratePpm: nonNegativeSafeInteger,
  treatment: taxTreatmentSchema,
  taxableBaseMinor: nonNegativeSafeInteger,
  taxMinor: nonNegativeSafeInteger,
  roundingAdjustmentMinor: safeInteger,
});

export const taxSummaryResponseSchema = z.object({
  metadata: reportMetadataSchema,
  refundsTaxAllocated: z.literal(false),
  rows: z.array(taxSummaryRowSchema),
});
export type TaxSummaryResponse = z.infer<typeof taxSummaryResponseSchema>;

export const shiftReconciliationRowSchema = z.object({
  shiftId: z.string().uuid(),
  businessDate: date,
  shiftStatus: z.string().min(1),
  openingFloatMinor: nonNegativeSafeInteger,
  confirmedCashPaymentsMinor: nonNegativeSafeInteger,
  confirmedCashRefundsMinor: nonNegativeSafeInteger,
  postedCashInMinor: nonNegativeSafeInteger,
  postedCashOutMinor: nonNegativeSafeInteger,
  recomputedExpectedCashMinor: safeInteger,
  storedExpectedCashMinor: safeInteger.nullable(),
  countedCashMinor: nonNegativeSafeInteger.nullable(),
  varianceMinor: safeInteger.nullable(),
  reconciliationStatus: z.enum(["OPEN", "MATCH", "MISMATCH"]),
  closedAt: z.string().datetime().nullable(),
});

export const shiftReconciliationResponseSchema = z.object({
  metadata: reportMetadataSchema,
  rows: z.array(shiftReconciliationRowSchema),
});
export type ShiftReconciliationResponse = z.infer<
  typeof shiftReconciliationResponseSchema
>;

export const reportExceptionRowSchema = z.object({
  id: z.string().uuid(),
  type: reportExceptionTypeSchema,
  occurredAt: z.string().datetime(),
  activityDate: date,
  status: z.string().min(1),
  amountMinor: safeInteger.nullable(),
  reference: z.string().min(1).nullable(),
});

export const reportExceptionsResponseSchema = z.object({
  metadata: reportMetadataSchema,
  rows: z.array(reportExceptionRowSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type ReportExceptionsResponse = z.infer<
  typeof reportExceptionsResponseSchema
>;
