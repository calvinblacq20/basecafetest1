import {
  kdsStationListResponseSchema,
  preparationTicketListResponseSchema,
  type KdsStationResponse,
  type PreparationTicketResponse,
} from "@base-cafe/contracts";
import {
  commandKey,
  createSessionStore,
  loginDevice,
  normalizeApiV1Base,
  requestJson,
  type WebSession,
} from "@base-cafe/web-client";

const API_BASE = normalizeApiV1Base(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100",
);

export type KdsLoginInput = {
  email: string;
  password: string;
  deviceId: string;
  mfaCode?: string;
  mfaRecoveryCode?: string;
};

function store() {
  return createSessionStore("kds-web", window.sessionStorage);
}

export function rememberedKdsSession() {
  return store().load();
}

export async function signInKds(input: KdsLoginInput) {
  const session = await loginDevice(API_BASE, input);
  store().save(session);
  return session;
}

export function signOutKds() {
  store().clear();
}

function unauthorized() {
  signOutKds();
  window.dispatchEvent(new Event("base-cafe:kds-unauthorized"));
}

export async function loadKdsStations(session: WebSession) {
  const payload = await requestJson<unknown>(
    API_BASE,
    `/kds/branches/${session.scope.branchId}/stations`,
    { session, onUnauthorized: unauthorized },
  );
  return kdsStationListResponseSchema.parse(payload) as KdsStationResponse[];
}

export async function loadKdsTickets(session: WebSession, stationId?: string) {
  const query = new URLSearchParams({ limit: "200" });
  if (stationId) query.set("stationId", stationId);
  const payload = await requestJson<unknown>(
    API_BASE,
    `/kds/branches/${session.scope.branchId}/tickets?${query.toString()}`,
    { session, onUnauthorized: unauthorized },
  );
  return preparationTicketListResponseSchema.parse(
    payload,
  ) as PreparationTicketResponse[];
}

export async function advanceKdsTicket(
  session: WebSession,
  ticket: PreparationTicketResponse,
) {
  const transition =
    ticket.status === "QUEUED"
      ? "preparing"
      : ticket.status === "PREPARING"
        ? "ready"
        : "complete";
  await requestJson<unknown>(
    API_BASE,
    `/kds/tickets/${ticket.id}/${transition}`,
    {
      method: "POST",
      session,
      idempotencyKey: commandKey(`kds-${transition}`),
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        revision: ticket.revision,
        reason: `KDS operator moved ticket to ${transition}`,
      },
    },
  );
}
