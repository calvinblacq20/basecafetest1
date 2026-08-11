"use client";

import type {
  KdsStationResponse,
  PreparationTicketResponse,
  PreparationTicketStatus,
} from "@base-cafe/contracts";
import { Brand, Icon } from "@base-cafe/ui";
import { ApiError, type WebSession } from "@base-cafe/web-client";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  advanceKdsTicket,
  loadKdsStations,
  loadKdsTickets,
  rememberedKdsSession,
  signInKds,
  signOutKds,
} from "./kds-client";

const demoStations: KdsStationResponse[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Demo Kitchen",
    kind: "KITCHEN",
  },
];

const demoTickets: PreparationTicketResponse[] = [
  demoTicket("01", "QUEUED", "DINE_IN", "Table 06", "Demo Smash Burger"),
  demoTicket("02", "PREPARING", "TAKEAWAY", "Takeaway", "Demo Garden Pizza"),
  demoTicket("03", "READY", "BAR_TAB", "Demo bar tab", "Demo Spiced Wings"),
  demoTicket("04", "CANCELLED", "DINE_IN", "Table 12", "Demo Jollof Bowl"),
];

function demoTicket(
  suffix: string,
  status: PreparationTicketStatus,
  channel: PreparationTicketResponse["channel"],
  serviceReference: string,
  itemName: string,
): PreparationTicketResponse {
  const id = `10000000-0000-4000-8000-0000000000${suffix}`;
  const fixtureMinute = String(20 + Number(suffix)).padStart(2, "0");
  const fixtureTime = `2026-08-09T08:${fixtureMinute}:00.000Z`;
  return {
    id,
    branchId: "20000000-0000-4000-8000-000000000001",
    stationId: demoStations[0]!.id,
    stationName: demoStations[0]!.name,
    orderId: `30000000-0000-4000-8000-0000000000${suffix}`,
    sendWaveId: `40000000-0000-4000-8000-0000000000${suffix}`,
    waveNumber: 1,
    status,
    revision: 1,
    orderNumber: `DEMO-${suffix}`,
    channel,
    serviceReference,
    cashierName: "Demo Cashier",
    businessDate: "2026-08-09",
    queuedAt: fixtureTime,
    preparingAt: status === "QUEUED" ? null : fixtureTime,
    readyAt: status === "READY" ? fixtureTime : null,
    completedAt: null,
    cancelledAt: status === "CANCELLED" ? fixtureTime : null,
    entries: [
      {
        id: `50000000-0000-4000-8000-0000000000${suffix}`,
        orderLineId: `60000000-0000-4000-8000-0000000000${suffix}`,
        kind: "ITEM",
        quantity: suffix === "01" ? 2 : 1,
        itemName,
        variantName: null,
        modifierName: null,
        modifierGroup: null,
        modifierSummary: [],
        note: suffix === "01" ? "No onions" : null,
        cancelledAt: status === "CANCELLED" ? fixtureTime : null,
      },
    ],
  };
}

const columns: ReadonlyArray<{
  status: "QUEUED" | "PREPARING" | "READY";
  label: string;
  action: string;
}> = [
  { status: "QUEUED", label: "New", action: "Start" },
  { status: "PREPARING", label: "Preparing", action: "Mark ready" },
  { status: "READY", label: "Ready", action: "Complete" },
];

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The kitchen queue could not be loaded.";
}

function elapsed(queuedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(queuedAt)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function reference(ticket: PreparationTicketResponse) {
  return (
    ticket.serviceReference ??
    (
      {
        DINE_IN: "Dine-in",
        TAKEAWAY: "Takeaway",
        PHONE_DELIVERY: "Delivery",
        BAR_TAB: "Bar tab",
      } as const
    )[ticket.channel]
  );
}

export function KitchenShell({ demo = false }: { demo?: boolean }) {
  const [session, setSession] = useState<WebSession | null>(null);
  const [ready, setReady] = useState(demo);
  const [stations, setStations] = useState<KdsStationResponse[]>(
    demo ? demoStations : [],
  );
  const [stationId, setStationId] = useState(demo ? demoStations[0]!.id : "");
  const [tickets, setTickets] = useState<PreparationTicketResponse[]>(
    demo ? demoTickets : [],
  );
  const [compact, setCompact] = useState(false);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (demo) return;
    const restore = window.setTimeout(() => {
      setSession(rememberedKdsSession());
      setReady(true);
    }, 0);
    const unauthorized = () => setSession(null);
    window.addEventListener("base-cafe:kds-unauthorized", unauthorized);
    return () => {
      window.clearTimeout(restore);
      window.removeEventListener("base-cafe:kds-unauthorized", unauthorized);
    };
  }, [demo]);

  const refresh = useCallback(async () => {
    if (demo || !session) return;
    try {
      const nextStations = await loadKdsStations(session);
      const nextStationId =
        stationId && nextStations.some((station) => station.id === stationId)
          ? stationId
          : (nextStations[0]?.id ?? "");
      const nextTickets = await loadKdsTickets(
        session,
        nextStationId || undefined,
      );
      setStations(nextStations);
      setStationId(nextStationId);
      setTickets(nextTickets);
      setLastUpdated(Date.now());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [demo, session, stationId]);

  useEffect(() => {
    if (!session || demo) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [demo, refresh, session]);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (demo) setLastUpdated((value) => value ?? current);
    };
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [demo]);

  const activeTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status !== "COMPLETED"),
    [tickets],
  );
  const cancelled = activeTickets.filter(
    (ticket) => ticket.status === "CANCELLED",
  );

  async function transition(ticket: PreparationTicketResponse) {
    if (demo) {
      const next =
        ticket.status === "QUEUED"
          ? "PREPARING"
          : ticket.status === "PREPARING"
            ? "READY"
            : "COMPLETED";
      setTickets((current) =>
        current.map((item) =>
          item.id === ticket.id
            ? { ...item, status: next, revision: item.revision + 1 }
            : item,
        ),
      );
      return;
    }
    if (!session) return;
    setBusyTicketId(ticket.id);
    try {
      await advanceKdsTicket(session, ticket);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_REVISION")
        await refresh();
      else setError(errorMessage(cause));
    } finally {
      setBusyTicketId(null);
    }
  }

  if (!ready)
    return <main className="kds-loading">Loading kitchen display…</main>;
  if (!demo && !session) return <KdsLogin onSignedIn={setSession} />;

  return (
    <main className={compact ? "kds-app is-compact" : "kds-app"}>
      <header className="kds-topbar">
        <Brand />
        <div className="kds-divider" />
        <label className="station-select">
          <Icon name="kitchen" size={24} />
          <select
            value={stationId}
            onChange={(event) => setStationId(event.target.value)}
          >
            {stations.length === 0 ? (
              <option value="">No active station</option>
            ) : null}
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
        </label>
        <div className="kds-topbar__spacer" />
        <div className="kds-sync">
          <span className={error ? "is-error" : ""} />
          {error
            ? "Connection issue"
            : lastUpdated
              ? `Online · updated ${Math.max(0, Math.floor((now - lastUpdated) / 1000))}s ago`
              : "Connecting…"}
        </div>
        <div className="kds-divider" />
        <div className="kds-clock">
          <Icon name="clock" size={26} />
          <strong>
            {now
              ? new Date(now).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "--:--"}
          </strong>
        </div>
        <button
          aria-pressed={compact}
          className="compact-button"
          onClick={() => setCompact((value) => !value)}
          type="button"
        >
          <Icon name="grid" size={22} />
          Compact
        </button>
        {!demo ? (
          <button
            className="kds-signout"
            onClick={() => {
              signOutKds();
              setSession(null);
            }}
            type="button"
          >
            Sign out
          </button>
        ) : null}
      </header>

      <section className="kds-toolbar">
        <p>
          {demo
            ? "Fictional demo queue · live actions are disabled"
            : `${activeTickets.length} active ticket${activeTickets.length === 1 ? "" : "s"} · refreshes every two seconds`}
        </p>
        {error ? (
          <button
            className="recall-button"
            onClick={() => void refresh()}
            type="button"
          >
            Retry now
          </button>
        ) : null}
      </section>

      <section className="kds-board" aria-label="Kitchen production queue">
        {columns.map((column) => {
          const items = activeTickets.filter(
            (ticket) => ticket.status === column.status,
          );
          return (
            <section
              aria-labelledby={`${column.status}-heading`}
              className={`queue-column queue-column--${column.status.toLocaleLowerCase()}`}
              key={column.status}
            >
              <header className="queue-heading">
                <Icon
                  name={
                    column.status === "QUEUED"
                      ? "orders"
                      : column.status === "PREPARING"
                        ? "kitchen"
                        : "spark"
                  }
                  size={24}
                />
                <h2 id={`${column.status}-heading`}>{column.label}</h2>
                <strong>{items.length}</strong>
              </header>
              <div className="ticket-list">
                {items.length ? (
                  items.map((ticket) => (
                    <article
                      className={
                        now - Date.parse(ticket.queuedAt) > 600_000
                          ? "ticket is-overdue"
                          : "ticket"
                      }
                      key={ticket.id}
                    >
                      <div className="ticket__heading">
                        <div>
                          <Icon
                            name={
                              ticket.channel === "DINE_IN"
                                ? "table"
                                : ticket.channel === "PHONE_DELIVERY"
                                  ? "send"
                                  : ticket.channel === "BAR_TAB"
                                    ? "spark"
                                    : "bag"
                            }
                            size={22}
                          />
                          <strong>{reference(ticket)}</strong>
                          <span>· {ticket.orderNumber}</span>
                        </div>
                        <div className="ticket__timer">
                          <strong>{elapsed(ticket.queuedAt, now)}</strong>
                        </div>
                      </div>
                      <div className="send-wave">
                        <Icon name="send" size={18} />
                        Send wave {ticket.waveNumber} · {ticket.cashierName}
                      </div>
                      <div className="ticket__items">
                        {ticket.entries.map((entry) => (
                          <div
                            className={
                              entry.cancelledAt
                                ? "ticket-item is-cancelled"
                                : "ticket-item"
                            }
                            key={entry.id}
                          >
                            <span className="ticket-item__quantity">
                              {entry.quantity}
                            </span>
                            <div>
                              <strong>
                                ×&nbsp; {entry.modifierName ?? entry.itemName}
                                {entry.variantName
                                  ? ` · ${entry.variantName}`
                                  : ""}
                              </strong>
                              {entry.modifierSummary.map((modifier) => (
                                <span
                                  key={`${entry.id}-${modifier.group}-${modifier.name}`}
                                >
                                  {modifier.quantity}× {modifier.name}
                                </span>
                              ))}
                              {entry.note ? <span>{entry.note}</span> : null}
                              {entry.cancelledAt ? (
                                <span className="cancelled-note">
                                  Cancelled
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="ticket__actions">
                        <button
                          disabled={busyTicketId === ticket.id}
                          onClick={() => void transition(ticket)}
                          type="button"
                        >
                          <Icon
                            name={column.status === "QUEUED" ? "send" : "spark"}
                            size={22}
                          />
                          {busyTicketId === ticket.id
                            ? "Updating…"
                            : column.action}
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="queue-empty">
                    <Icon name="spark" size={30} />
                    <strong>
                      No {column.label.toLocaleLowerCase()} tickets
                    </strong>
                    <span>
                      {demo
                        ? "Use another demo ticket to see this state."
                        : "New server activity appears here automatically."}
                    </span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </section>

      {cancelled.length ? (
        <aside
          className="cancelled-strip"
          aria-label="Cancelled ticket entries"
        >
          <strong>Cancelled</strong>
          {cancelled.map((ticket) => (
            <span key={ticket.id}>
              {ticket.orderNumber} · {reference(ticket)}
            </span>
          ))}
        </aside>
      ) : null}
      {error ? (
        <div className="kds-toast" role="alert">
          <span>{error}</span>
          <button
            aria-label="Dismiss message"
            onClick={() => setError(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}

function KdsLogin({
  onSignedIn,
}: {
  onSignedIn: (session: WebSession) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [secondFactor, setSecondFactor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="kds-login">
      <form
        className="kds-login__card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onSignedIn(
              await signInKds({
                email,
                password,
                deviceId,
                ...(secondFactor
                  ? /^\d{6}$/.test(secondFactor)
                    ? { mfaCode: secondFactor }
                    : { mfaRecoveryCode: secondFactor.toUpperCase() }
                  : {}),
              }),
            );
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Brand />
        <div>
          <p className="eyebrow">Device-bound access</p>
          <h1>Kitchen sign in</h1>
          <p>
            Use an enrolled KDS device and a staff account with kitchen
            permissions.
          </p>
        </div>
        <label>
          Email
          <input
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label>
          Device ID
          <input
            onChange={(event) => setDeviceId(event.target.value)}
            pattern="[0-9a-fA-F-]{36}"
            required
            value={deviceId}
          />
        </label>
        <label>
          Authenticator or recovery code <span>(if enabled)</span>
          <input
            autoComplete="one-time-code"
            onChange={(event) => setSecondFactor(event.target.value.trim())}
            value={secondFactor}
          />
        </label>
        {error ? (
          <p className="kds-login__error" role="alert">
            {error}
          </p>
        ) : null}
        <button disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in to KDS"}
        </button>
        <a href="?demo=1">Open fictional demo instead</a>
      </form>
    </main>
  );
}
