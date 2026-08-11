"use client";

import { Brand, Icon, type IconName } from "@base-cafe/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
type Alert = {
  id: string;
  revision: number;
  code: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: AlertStatus;
  summary: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  branch: { id: string; name: string } | null;
};
type Session = {
  id: string;
  revision: number;
  status: string;
  effectiveStatus: string;
  lastUsedAt: string;
  expiresAt: string;
  user: { id: string; displayName: string; status: string };
  device: {
    id: string;
    name: string;
    status: string;
    branch: { id: string; name: string };
  };
};
type Audit = {
  id: string;
  occurredAt: string;
  action: string;
  outcome: string;
  actor: { id: string; displayName: string } | null;
  branch: { id: string; name: string } | null;
  entityType: string;
  entityId: string | null;
  reason: string | null;
};
type KeyPosture = {
  configured: boolean;
  activeKeyVersion: string | null;
  readableKeyVersions: string[];
  customerProfileEnvelopes: { keyVersion: string | null; count: number }[];
  orderContactEnvelopes: { keyVersion: string | null; count: number }[];
  legacyPlaintext: { phoneRowCount: number; deliveryDirectionRowCount: number };
};
type PendingAction =
  | { kind: "revoke"; item: Session }
  | { kind: "acknowledge" | "resolve"; item: Alert };

const navItems: readonly { icon: IconName; label: string; href: string }[] = [
  { icon: "grid", label: "Overview", href: "/" },
  { icon: "bag", label: "Catalog", href: "/" },
  { icon: "users", label: "Staff & roles", href: "/" },
  { icon: "monitor", label: "Devices", href: "/" },
  { icon: "audit", label: "Security & audit", href: "/security" },
  { icon: "shift", label: "Pilot readiness", href: "/readiness" },
  { icon: "upload", label: "Imports", href: "/" },
];

const demoAlerts: Alert[] = [
  demoAlert(
    "alert-1",
    "LOGIN_LOCKOUT",
    "CRITICAL",
    "Repeated sign-in lockouts require review",
    12,
  ),
  demoAlert(
    "alert-2",
    "SESSION_REVOKED",
    "WARNING",
    "A device session was revoked",
    3,
  ),
  demoAlert(
    "alert-3",
    "ROLE_ASSIGNMENT_CHANGED",
    "INFO",
    "A staff role assignment changed",
    2,
  ),
];
const demoSessions: Session[] = [
  demoSession(
    "session-1",
    "Demo Manager",
    "DEMO POS Terminal 1",
    "DEMO Main Branch",
    8,
  ),
  demoSession(
    "session-2",
    "Demo Cashier",
    "DEMO POS Terminal 2",
    "DEMO Main Branch",
    21,
  ),
  demoSession(
    "session-3",
    "Demo Supervisor",
    "DEMO Admin Laptop",
    "DEMO Main Branch",
    47,
  ),
];
const demoAudits: Audit[] = [
  demoAudit(
    "audit-1",
    "security.session.revoke",
    "Demo Manager",
    "session",
    "Reviewed demo revocation",
  ),
  demoAudit(
    "audit-2",
    "administration.staff.role.assigned",
    "Demo Owner",
    "user_role",
    "Demo assignment",
  ),
  demoAudit("audit-3", "auth.login", "Demo Cashier", "session", null),
];
const demoPosture: KeyPosture = {
  configured: true,
  activeKeyVersion: "demo-v2",
  readableKeyVersions: ["demo-v1", "demo-v2"],
  customerProfileEnvelopes: [{ keyVersion: "demo-v2", count: 24 }],
  orderContactEnvelopes: [{ keyVersion: "demo-v2", count: 38 }],
  legacyPlaintext: { phoneRowCount: 0, deliveryDirectionRowCount: 0 },
};

export function SecurityOperationsShell({
  initialDemo = false,
}: {
  initialDemo?: boolean;
}) {
  const [alerts, setAlerts] = useState<Alert[]>(initialDemo ? demoAlerts : []);
  const [sessions, setSessions] = useState<Session[]>(
    initialDemo ? demoSessions : [],
  );
  const [audits, setAudits] = useState<Audit[]>(initialDemo ? demoAudits : []);
  const [posture, setPosture] = useState<KeyPosture | null>(
    initialDemo ? demoPosture : null,
  );
  const [status, setStatus] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >(initialDemo ? "ready" : "loading");
  const [notice, setNotice] = useState("");
  const [alertFilter, setAlertFilter] = useState<"ACTIVE" | AlertStatus>(
    "ACTIVE",
  );
  const [auditQuery, setAuditQuery] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [demo, setDemo] = useState(initialDemo);

  const load = useCallback(async () => {
    if (initialDemo) {
      setDemo(true);
      setAlerts(demoAlerts);
      setSessions(demoSessions);
      setAudits(demoAudits);
      setPosture(demoPosture);
      setStatus("ready");
      return;
    }
    const token = window.sessionStorage.getItem("base-cafe-admin.access-token");
    if (!token) {
      setStatus("signed-out");
      return;
    }
    try {
      const [alertsPage, sessionsPage, auditPage, keys] = await Promise.all([
        request<{ items: Alert[] }>("/security/alerts?limit=20", token),
        request<{ items: Session[] }>(
          "/security/sessions?status=ACTIVE&limit=20",
          token,
        ),
        request<{ items: Audit[] }>("/audit?limit=20", token),
        request<KeyPosture>("/security/privacy/key-posture", token),
      ]);
      setAlerts(alertsPage.items);
      setSessions(sessionsPage.items);
      setAudits(auditPage.items);
      setPosture(keys);
      setStatus("ready");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        window.sessionStorage.removeItem("base-cafe-admin.access-token");
        setStatus("signed-out");
        setNotice(
          "Your session is no longer valid. Sign in again to continue.",
        );
      } else {
        setStatus("error");
        setNotice(
          error instanceof Error
            ? error.message
            : "Security data could not be loaded.",
        );
      }
    }
  }, [initialDemo]);

  useEffect(() => {
    if (initialDemo) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [initialDemo, load]);

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((alert) =>
        alertFilter === "ACTIVE"
          ? alert.status !== "RESOLVED"
          : alert.status === alertFilter,
      ),
    [alertFilter, alerts],
  );
  const filteredAudits = useMemo(() => {
    const normalized = auditQuery.trim().toLowerCase();
    if (!normalized) return audits;
    return audits.filter((event) =>
      `${event.action} ${event.actor?.displayName ?? "system"} ${event.entityType}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [auditQuery, audits]);
  const openAlerts = alerts.filter(
    (alert) => alert.status !== "RESOLVED",
  ).length;
  const encryptedRecords = posture
    ? [
        ...posture.customerProfileEnvelopes,
        ...posture.orderContactEnvelopes,
      ].reduce((total, row) => total + row.count, 0)
    : 0;

  async function confirmAction() {
    if (!pending || reason.trim().length < 3) return;
    if (demo) {
      if (pending.kind === "revoke")
        setSessions((current) =>
          current.filter(({ id }) => id !== pending.item.id),
        );
      else
        setAlerts((current) =>
          current.map((alert) =>
            alert.id === pending.item.id
              ? {
                  ...alert,
                  status:
                    pending.kind === "resolve" ? "RESOLVED" : "ACKNOWLEDGED",
                }
              : alert,
          ),
        );
      setNotice("Demo state updated locally; no server record was written.");
      setPending(null);
      setReason("");
      return;
    }
    const token = window.sessionStorage.getItem("base-cafe-admin.access-token");
    if (!token) return void setStatus("signed-out");
    const path =
      pending.kind === "revoke"
        ? `/security/sessions/${pending.item.id}/revoke`
        : `/security/alerts/${pending.item.id}/${pending.kind}`;
    try {
      await request(path, token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          revision: pending.item.revision,
          reason: reason.trim(),
        }),
      });
      setPending(null);
      setReason("");
      setNotice("Security action recorded with audit history.");
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The security action failed.",
      );
    }
  }

  async function exportAudit() {
    if (demo)
      return void setNotice(
        "Audit export is disabled for development demo data.",
      );
    const token = window.sessionStorage.getItem("base-cafe-admin.access-token");
    if (!token) return void setStatus("signed-out");
    const response = await fetch(`${apiBase()}/audit/export.csv?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      window.sessionStorage.removeItem("base-cafe-admin.access-token");
      return void setStatus("signed-out");
    }
    if (!response.ok)
      return void setNotice("The audit export was not authorized.");
    const blob = await response.blob();
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "base-cafe-audit.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <main className="security-app">
      <aside className="security-rail">
        <div className="security-rail__brand">
          <Brand label="Base Cafe" />
          <small>ADMIN</small>
        </div>
        <nav aria-label="Admin navigation">
          {navItems.map((item) => (
            <Link
              className={item.href === "/security" ? "is-active" : ""}
              href={item.href}
              key={item.label}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <Link className="security-rail__back" href="/">
          <span aria-hidden="true">‹</span> Back to catalog
        </Link>
      </aside>

      <header className="security-topbar">
        <strong>Base Cafe Admin</strong>
        <span className="security-divider" />
        <span className="security-branch">
          <Icon name="grid" size={17} /> Organization security
        </span>
        <div className="security-topbar__space" />
        <span
          className={`security-health ${status === "ready" ? "is-good" : ""}`}
        >
          <Icon name="audit" size={18} />{" "}
          {status === "ready" ? "Protected session" : "Authentication required"}
        </span>
        <span className="security-divider" />
        <span className="security-avatar">BA</span>
        <span>
          <strong>Authorized operator</strong>
          <small>Security console</small>
        </span>
      </header>

      <section className="security-content">
        <div className="security-titlebar">
          <div>
            <p className="security-eyebrow">OPERATIONS CONTROL</p>
            <h1>Security &amp; audit</h1>
            <p>
              Review alerts, revoke sessions, inspect immutable activity, and
              verify encryption posture.
            </p>
          </div>
          <button
            className="security-refresh"
            onClick={() => void load()}
            type="button"
          >
            <Icon name="recall" size={17} /> Refresh
          </button>
        </div>
        {demo && (
          <div className="security-demo">
            Development preview — all records on this screen are labeled
            demonstration data.
          </div>
        )}
        {notice && (
          <button
            className="security-notice"
            onClick={() => setNotice("")}
            type="button"
          >
            {notice}
            <span>×</span>
          </button>
        )}
        {status === "signed-out" && (
          <div className="security-auth-card">
            <Icon name="audit" size={32} />
            <div>
              <h2>Authenticated admin session required</h2>
              <p>
                Sign in through the approved admin authentication flow. Revoked
                and expired sessions are removed from this browser
                automatically.
              </p>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="security-auth-card is-error">
            <Icon name="wifi" size={32} />
            <div>
              <h2>Security data is unavailable</h2>
              <p>
                Use Refresh after the API connection has recovered. Cached
                security records are never shown as current.
              </p>
            </div>
          </div>
        )}
        {status === "loading" && (
          <div className="security-loading">
            Loading protected security data…
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="security-metrics">
              <Metric
                icon="audit"
                tone="danger"
                label="Open alerts"
                value={String(openAlerts)}
                note="Requires review"
              />
              <Metric
                icon="users"
                tone="good"
                label="Active sessions"
                value={String(sessions.length)}
                note="Across authorized branches"
              />
              <Metric
                icon="monitor"
                tone="warn"
                label="Key versions"
                value={String(posture?.readableKeyVersions.length ?? 0)}
                note={
                  posture?.configured
                    ? "Encryption configured"
                    : "Configuration issue"
                }
              />
              <Metric
                icon="audit"
                tone="good"
                label="Encrypted records"
                value={String(encryptedRecords)}
                note="No plaintext exposed"
              />
            </div>

            <div className="security-split">
              <section className="security-card">
                <header>
                  <div>
                    <h2>Security alerts</h2>
                    <p>Deduplicated internal signals</p>
                  </div>
                  <select
                    value={alertFilter}
                    onChange={(event) =>
                      setAlertFilter(event.target.value as typeof alertFilter)
                    }
                  >
                    <option value="ACTIVE">Open + acknowledged</option>
                    <option value="OPEN">Open</option>
                    <option value="ACKNOWLEDGED">Acknowledged</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                </header>
                <div className="security-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Alert</th>
                        <th>Last seen</th>
                        <th>Count</th>
                        <th>Status</th>
                        <th>
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlerts.map((alert) => (
                        <tr key={alert.id}>
                          <td>
                            <span
                              className={`severity-dot is-${alert.severity.toLowerCase()}`}
                            />
                            {title(alert.severity)}
                          </td>
                          <td>
                            <strong>{alert.code}</strong>
                            <small>{alert.summary}</small>
                          </td>
                          <td>{formatTime(alert.lastSeenAt)}</td>
                          <td>{alert.occurrenceCount}</td>
                          <td>
                            <Status value={alert.status} />
                          </td>
                          <td>
                            <button
                              className="security-action"
                              onClick={() =>
                                setPending({
                                  kind:
                                    alert.status === "OPEN"
                                      ? "acknowledge"
                                      : "resolve",
                                  item: alert,
                                })
                              }
                              disabled={alert.status === "RESOLVED"}
                              type="button"
                            >
                              {alert.status === "OPEN"
                                ? "Review"
                                : alert.status === "ACKNOWLEDGED"
                                  ? "Resolve"
                                  : "Closed"}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredAlerts.length === 0 && (
                        <tr>
                          <td className="security-empty" colSpan={6}>
                            No alerts match this view.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="security-card">
                <header>
                  <div>
                    <h2>Active sessions</h2>
                    <p>Token values and IP addresses are excluded</p>
                  </div>
                  <span className="security-count">
                    {sessions.length} active
                  </span>
                </header>
                <div className="security-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff</th>
                        <th>Device</th>
                        <th>Branch</th>
                        <th>Last used</th>
                        <th>
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => (
                        <tr key={session.id}>
                          <td>
                            <strong>{session.user.displayName}</strong>
                            <small>{session.user.status}</small>
                          </td>
                          <td>{session.device.name}</td>
                          <td>{session.device.branch.name}</td>
                          <td>{formatTime(session.lastUsedAt)}</td>
                          <td>
                            <button
                              className="security-action"
                              onClick={() =>
                                setPending({ kind: "revoke", item: session })
                              }
                              type="button"
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                      {sessions.length === 0 && (
                        <tr>
                          <td className="security-empty" colSpan={5}>
                            No active sessions.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="security-lower">
              <section className="security-card security-audit">
                <header>
                  <div>
                    <h2>Audit history</h2>
                    <p>Redacted, branch-scoped activity</p>
                  </div>
                  <div className="security-audit-tools">
                    <label>
                      <Icon name="search" size={16} />
                      <input
                        aria-label="Filter audit history"
                        onChange={(event) => setAuditQuery(event.target.value)}
                        placeholder="Filter activity"
                        value={auditQuery}
                      />
                    </label>
                    <button onClick={() => void exportAudit()} type="button">
                      <Icon name="upload" size={16} /> Export CSV
                    </button>
                  </div>
                </header>
                <div className="security-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Outcome</th>
                        <th>Actor</th>
                        <th>Entity</th>
                        <th>Branch</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAudits.map((event) => (
                        <tr key={event.id}>
                          <td>{formatTime(event.occurredAt)}</td>
                          <td>
                            <strong>{event.action}</strong>
                          </td>
                          <td>
                            <Status value={event.outcome} />
                          </td>
                          <td>{event.actor?.displayName ?? "System"}</td>
                          <td>{event.entityType}</td>
                          <td>{event.branch?.name ?? "Organization"}</td>
                          <td className="security-reason">
                            {event.reason ?? "—"}
                          </td>
                        </tr>
                      ))}
                      {filteredAudits.length === 0 && (
                        <tr>
                          <td className="security-empty" colSpan={7}>
                            No audit events match this filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="security-card security-keys">
                <header>
                  <div>
                    <h2>Privacy key posture</h2>
                    <p>Key material is never returned</p>
                  </div>
                </header>
                <div className="security-key-stat">
                  <span>Configuration</span>
                  <strong
                    className={
                      posture?.configured ? "is-positive" : "is-negative"
                    }
                  >
                    {posture?.configured ? "Ready" : "Missing"}
                  </strong>
                </div>
                <div className="security-key-stat">
                  <span>Active version</span>
                  <strong>
                    {posture?.activeKeyVersion ?? "Not configured"}
                  </strong>
                </div>
                <div className="security-key-stat">
                  <span>Readable versions</span>
                  <strong>{posture?.readableKeyVersions.length ?? 0}</strong>
                </div>
                <div className="security-key-stat">
                  <span>Legacy plaintext rows</span>
                  <strong>
                    {(posture?.legacyPlaintext.phoneRowCount ?? 0) +
                      (posture?.legacyPlaintext.deliveryDirectionRowCount ?? 0)}
                  </strong>
                </div>
                <p className="security-key-note">
                  Rotation rewrap is bounded, idempotent, audited, and
                  restricted to privacy-key managers.
                </p>
              </aside>
            </div>
          </>
        )}
      </section>

      {pending && (
        <div className="security-modal" role="presentation">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmAction();
            }}
          >
            <p className="security-eyebrow">CONTROLLED ACTION</p>
            <h2>
              {pending.kind === "revoke"
                ? "Revoke staff session"
                : pending.kind === "resolve"
                  ? "Resolve security alert"
                  : "Acknowledge security alert"}
            </h2>
            <p>
              This action takes effect immediately and creates immutable audit
              and outbox records.
            </p>
            <label>
              Reason
              <textarea
                autoFocus
                minLength={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter the reviewed operational reason"
                required
                value={reason}
              />
            </label>
            <div>
              <button
                onClick={() => {
                  setPending(null);
                  setReason("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="is-danger"
                disabled={reason.trim().length < 3}
                type="submit"
              >
                Confirm action
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function Metric({
  icon,
  label,
  note,
  tone,
  value,
}: {
  icon: IconName;
  label: string;
  note: string;
  tone: string;
  value: string;
}) {
  return (
    <article className="security-metric">
      <span className={`security-metric__icon is-${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`security-status is-${value.toLowerCase()}`}>
      {title(value)}
    </span>
  );
}
function title(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));
}
function apiBase() {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1"
  ).replace(/\/$/, "");
}
class UnauthorizedError extends Error {}
async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(detail?.message ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
function demoAlert(
  id: string,
  code: string,
  severity: Alert["severity"],
  summary: string,
  count: number,
): Alert {
  const now = new Date();
  return {
    id,
    revision: 1,
    code,
    severity,
    status: "OPEN",
    summary,
    occurrenceCount: count,
    firstSeenAt: new Date(now.getTime() - 3_600_000).toISOString(),
    lastSeenAt: now.toISOString(),
    branch: { id: "demo-branch", name: "DEMO Main Branch" },
  };
}
function demoSession(
  id: string,
  displayName: string,
  deviceName: string,
  branchName: string,
  minutesAgo: number,
): Session {
  return {
    id,
    revision: 1,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    lastUsedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    user: { id: `${id}-user`, displayName, status: "ACTIVE" },
    device: {
      id: `${id}-device`,
      name: deviceName,
      status: "ACTIVE",
      branch: { id: "demo-branch", name: branchName },
    },
  };
}
function demoAudit(
  id: string,
  action: string,
  actor: string,
  entityType: string,
  reason: string | null,
): Audit {
  return {
    id,
    occurredAt: new Date(
      Date.now() - Number(id.at(-1)) * 11 * 60_000,
    ).toISOString(),
    action,
    outcome: "SUCCESS",
    actor: { id: `${id}-actor`, displayName: actor },
    branch: { id: "demo-branch", name: "DEMO Main Branch" },
    entityType,
    entityId: `${id}-entity`,
    reason,
  };
}
