import {
  cashMovementListResponseSchema,
  cashMovementResponseSchema,
  type CashMovementListResponse,
  type CashMovementResponse,
  type CashMovementType,
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

export async function listCashMovements(
  session: RuntimeSession,
): Promise<CashMovementListResponse> {
  if (!navigator.onLine)
    throw new Error("CASH_MOVEMENT_LIST_REQUIRES_CONNECTION");
  const query = new URLSearchParams({ limit: "100" });
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/cash-movements/branches/${session.scope.branchId}?${query.toString()}`,
    {
      session: webSession(session),
      onUnauthorized: unauthorized,
    },
  );
  return cashMovementListResponseSchema.parse(response);
}

export async function requestCashMovement(
  session: RuntimeSession,
  shift: { id: string; revision: number },
  input: {
    type: CashMovementType;
    direction: "IN" | "OUT";
    amountMinor: number;
    correctsMovementId?: string;
    reference?: string;
    evidenceNote: string;
    reason: string;
  },
): Promise<CashMovementResponse> {
  if (!navigator.onLine)
    throw new Error("CASH_MOVEMENT_REQUEST_REQUIRES_CONNECTION");
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    "/api/v1/cash-movements",
    {
      method: "POST",
      session: webSession(session),
      idempotencyKey: commandKey("cash-movement-request"),
      onUnauthorized: unauthorized,
      body: {
        movementId: crypto.randomUUID(),
        branchId: session.scope.branchId,
        shiftId: shift.id,
        shiftRevision: shift.revision,
        ...input,
        correctsMovementId: input.correctsMovementId ?? null,
        reference: input.reference || null,
      },
    },
  );
  return cashMovementResponseSchema.parse(response);
}

export async function approveCashMovement(
  session: RuntimeSession,
  movement: CashMovementResponse,
  decision: "APPROVE" | "REJECT",
  evidenceNote: string,
  reason: string,
): Promise<CashMovementResponse> {
  if (!navigator.onLine)
    throw new Error("CASH_MOVEMENT_APPROVAL_REQUIRES_CONNECTION");
  const response = await requestJson<unknown>(
    apiBaseUrl(),
    `/api/v1/cash-movements/${movement.id}/approve`,
    {
      method: "POST",
      session: webSession(session),
      idempotencyKey: commandKey("cash-movement-approval"),
      onUnauthorized: unauthorized,
      body: {
        approvalId: crypto.randomUUID(),
        branchId: session.scope.branchId,
        revision: movement.revision,
        decision,
        evidenceNote,
        reason,
      },
    },
  );
  return cashMovementResponseSchema.parse(response);
}
