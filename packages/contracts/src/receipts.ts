import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

export const fiscalDocumentStatusSchema = z.enum([
  "NOT_REQUIRED",
  "PENDING",
  "ISSUED",
  "FAILED",
  "OFFLINE_PENDING",
  "CANCELLED",
  "CREDIT_NOTE",
  "RECONCILED",
]);
export type FiscalDocumentStatus = z.infer<typeof fiscalDocumentStatusSchema>;

export const printJobStatusSchema = z.enum([
  "QUEUED",
  "PRINTING",
  "PRINTED",
  "FAILED",
  "CANCELLED",
]);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

export const createReceiptRequestSchema = z.object({
  receiptId: id,
  fiscalDocumentId: id,
  branchId: id,
  orderRevision: z.number().int().positive(),
  reason,
});
export type CreateReceiptRequest = z.infer<typeof createReceiptRequestSchema>;

export const receiptResponseSchema = z.object({
  id,
  branchId: id,
  orderId: id,
  receiptNumber: z.string().min(1).max(40),
  currency: z.string().length(3),
  renderedHtml: z.string().min(1),
  fiscalDocument: z.object({
    id,
    status: fiscalDocumentStatusSchema,
  }),
});
export type ReceiptResponse = z.infer<typeof receiptResponseSchema>;

export const reprintReceiptRequestSchema = z.object({
  reprintId: id,
  printJobId: id,
  branchId: id,
  copies: z.number().int().min(1).max(5).default(1),
  targetPrinter: z.string().trim().min(1).max(120).nullable().optional(),
  reason,
});
export type ReprintReceiptRequest = z.infer<typeof reprintReceiptRequestSchema>;

export const retryPrintJobRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  reason,
});
export type RetryPrintJobRequest = z.infer<typeof retryPrintJobRequestSchema>;

export const updatePrintJobRequestSchema = z.object({
  branchId: id,
  revision: z.number().int().positive(),
  status: z.enum(["PRINTING", "PRINTED", "FAILED", "CANCELLED"]),
  errorCode: z.string().trim().min(1).max(80).nullable().optional(),
  reason,
});
export type UpdatePrintJobRequest = z.infer<typeof updatePrintJobRequestSchema>;

export const receiptListQuerySchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReceiptListQuery = z.infer<typeof receiptListQuerySchema>;

export const printJobResponseSchema = z.object({
  id,
  receiptId: id,
  status: printJobStatusSchema,
  revision: z.number().int().positive(),
  copies: z.number().int().min(1).max(5),
  attemptCount: z.number().int().nonnegative(),
  targetPrinter: z.string().max(120).nullable(),
  errorCode: z.string().max(80).nullable(),
  printedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PrintJobResponse = z.infer<typeof printJobResponseSchema>;

export const receiptHistoryItemSchema = z.object({
  id,
  branchId: id,
  orderId: id,
  orderNumber: z.string().min(1).max(40),
  receiptNumber: z.string().min(1).max(40),
  businessDate: z.string().date(),
  currency: z.string().length(3),
  totalMinor: z.number().int().safe().nullable(),
  fiscalStatus: fiscalDocumentStatusSchema,
  reprintCount: z.number().int().nonnegative(),
  latestPrintJob: printJobResponseSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type ReceiptHistoryItem = z.infer<typeof receiptHistoryItemSchema>;

export const receiptHistoryListResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  items: z.array(receiptHistoryItemSchema),
});
export type ReceiptHistoryListResponse = z.infer<
  typeof receiptHistoryListResponseSchema
>;

export const receiptDetailResponseSchema = receiptHistoryItemSchema.extend({
  reprints: z.array(
    z.object({
      id,
      copies: z.number().int().min(1).max(5),
      createdAt: z.string().datetime(),
    }),
  ),
  printJobs: z.array(printJobResponseSchema),
});
export type ReceiptDetailResponse = z.infer<typeof receiptDetailResponseSchema>;
