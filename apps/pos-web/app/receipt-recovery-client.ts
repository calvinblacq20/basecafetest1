import {
  receiptDetailResponseSchema,
  receiptHistoryListResponseSchema,
  syncRecoveryListResponseSchema,
  type PrintJobResponse,
  type ReceiptDetailResponse,
  type ReceiptHistoryListResponse,
  type SyncRecoveryListResponse,
} from "@base-cafe/contracts";
import {
  commandKey,
  normalizeApiOrigin,
  requestJson,
  type WebSession,
} from "@base-cafe/web-client";

import type { RuntimeSession } from "./offline/cashier-runtime";

function apiBaseUrl() {
  return normalizeApiOrigin(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100",
  );
}

function webSession(session: RuntimeSession): WebSession {
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    offlineAccess: session.offlineAccess,
    scope: {
      organizationId: session.scope.organizationId,
      branchId: session.scope.branchId,
      deviceId: session.scope.deviceId,
    },
    user: {
      id: session.scope.userId,
      displayName: session.user.displayName,
      email: session.user.email,
      permissions: session.user.permissions,
      mustChangePassword: false,
      mfaActive: false,
    },
  };
}

function unauthorized() {
  window.dispatchEvent(new Event("base-cafe:pos-unauthorized"));
}

function requireOnline(code: string) {
  if (!navigator.onLine) throw new Error(code);
}

export async function listReceipts(
  session: RuntimeSession,
  search = "",
): Promise<ReceiptHistoryListResponse> {
  requireOnline("RECEIPT_HISTORY_REQUIRES_CONNECTION");
  const query = new URLSearchParams({ limit: "100" });
  if (search.trim()) query.set("search", search.trim());
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/receipts/branches/${session.scope.branchId}?${query.toString()}`,
    {
      session: webSession(session),
      onUnauthorized: unauthorized,
    },
  );
  return receiptHistoryListResponseSchema.parse(response);
}

export async function getReceiptDetail(
  session: RuntimeSession,
  receiptId: string,
): Promise<ReceiptDetailResponse> {
  requireOnline("RECEIPT_HISTORY_REQUIRES_CONNECTION");
  const query = new URLSearchParams({ branchId: session.scope.branchId });
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/receipts/${receiptId}?${query.toString()}`,
    { session: webSession(session), onUnauthorized: unauthorized },
  );
  return receiptDetailResponseSchema.parse(response);
}

export async function renderReceipt(
  session: RuntimeSession,
  receiptId: string,
  reprint = false,
) {
  requireOnline("RECEIPT_RENDER_REQUIRES_CONNECTION");
  const query = new URLSearchParams({
    branchId: session.scope.branchId,
    ...(reprint ? { reprint: "true" } : {}),
  });
  return requestJson<string>(
    apiBaseUrl(),
    `/api/v1/receipts/${receiptId}/render?${query.toString()}`,
    {
      session: webSession(session),
      headers: { accept: "text/html" },
      onUnauthorized: unauthorized,
    },
  );
}

export async function queueReceiptReprint(
  session: RuntimeSession,
  receiptId: string,
  reason: string,
) {
  requireOnline("RECEIPT_REPRINT_REQUIRES_CONNECTION");
  await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/receipts/${receiptId}/reprint`,
    {
      method: "POST",
      session: webSession(session),
      idempotencyKey: commandKey("receipt-history-reprint"),
      onUnauthorized: unauthorized,
      body: {
        reprintId: crypto.randomUUID(),
        printJobId: crypto.randomUUID(),
        branchId: session.scope.branchId,
        copies: 1,
        reason,
      },
    },
  );
  return renderReceipt(session, receiptId, true);
}

export async function retryPrintJob(
  session: RuntimeSession,
  printJob: PrintJobResponse,
  reason: string,
) {
  requireOnline("PRINT_JOB_RETRY_REQUIRES_CONNECTION");
  await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/print-jobs/${printJob.id}/retry`,
    {
      method: "POST",
      session: webSession(session),
      idempotencyKey: commandKey("print-job-retry"),
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        revision: printJob.revision,
        reason,
      },
    },
  );
}

export async function listServerRecovery(
  session: RuntimeSession,
): Promise<SyncRecoveryListResponse> {
  requireOnline("SYNC_RECOVERY_REQUIRES_CONNECTION");
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/sync/recovery/${session.scope.branchId}`,
    { session: webSession(session), onUnauthorized: unauthorized },
  );
  return syncRecoveryListResponseSchema.parse(response);
}

export async function acknowledgeServerCommand(
  session: RuntimeSession,
  commandId: string,
  reason: string,
) {
  requireOnline("SYNC_RECOVERY_REQUIRES_CONNECTION");
  await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/sync/commands/${commandId}/resolve`,
    {
      method: "POST",
      session: webSession(session),
      idempotencyKey: commandKey("sync-recovery-acknowledge"),
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        action: "ACKNOWLEDGED_NO_ACTION",
        successorCommandId: null,
        reason,
      },
    },
  );
}
