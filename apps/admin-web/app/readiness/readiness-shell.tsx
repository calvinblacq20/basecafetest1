"use client";

import { Brand, Icon, type IconName } from "@base-cafe/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type CheckStatus = "PASS" | "BLOCKED" | "UNCONFIRMED";
type Check = {
  code: string;
  category: "AUTOMATED" | "EVIDENCE";
  status: CheckStatus;
  summary: string;
  details?: Record<string, string | number | boolean | null>;
  evidenceId?: string | null;
  observedAt?: string | null;
};
type Readiness = {
  generatedAt: string;
  status: "READY" | "BLOCKED" | "UNCONFIRMED";
  counts: { blocked: number; unconfirmed: number; passed: number };
  blockingCodes: string[];
  unconfirmedCodes: string[];
  checks: Check[];
};
type Evidence = {
  id: string;
  code: string;
  outcome: "CONFIRMED" | "FAILED" | "REVOKED";
  observedAt: string;
  safeReference: string | null;
  reason: string;
  recordedAt: string;
};
type Review = {
  id: string;
  status: Readiness["status"];
  blockedCount: number;
  unconfirmedCount: number;
  passedCount: number;
  reason: string;
  recordedAt: string;
};
type Modal = "evidence" | "review" | null;

const navItems: readonly { icon: IconName; label: string; href: string }[] = [
  { icon: "grid", label: "Overview", href: "/" },
  { icon: "bag", label: "Catalog", href: "/" },
  { icon: "users", label: "Staff & roles", href: "/" },
  { icon: "monitor", label: "Devices", href: "/" },
  { icon: "audit", label: "Security & audit", href: "/security" },
  { icon: "shift", label: "Pilot readiness", href: "/readiness" },
  { icon: "upload", label: "Imports", href: "/" },
];

const evidenceCodes = [
  "OWNER_SCOPE_APPROVED",
  "ACCOUNTANT_TAX_APPROVED",
  "PAYMENT_PROCESS_APPROVED",
  "FISCAL_PROCESS_APPROVED",
  "PRIVACY_APPROVED",
  "HARDWARE_SITE_TESTED",
  "PRINTER_FLOW_TESTED",
  "OFFLINE_DRILL_PASSED",
  "RECONCILIATION_PASSED",
  "TRAINING_COMPLETED",
  "ROLLBACK_APPROVED",
  "INCIDENT_CONTACTS_APPROVED",
  "OWNER_PILOT_SIGNOFF",
] as const;
const demoTime = "2026-08-09T06:00:00.000Z";

const demoChecks: Check[] = [
  check(
    "DEPLOYMENT_ENVIRONMENT",
    "AUTOMATED",
    "BLOCKED",
    "Production runtime configuration is explicit and secret-safe.",
  ),
  check(
    "STAFF_ACCESS_CONFIGURED",
    "AUTOMATED",
    "PASS",
    "Active staff use named accounts without temporary credentials.",
  ),
  check(
    "BRANCH_CONFIGURATION:DEMO",
    "AUTOMATED",
    "PASS",
    "Core launch configuration for DEMO Main Branch.",
  ),
  check(
    "SALE_CATALOG:DEMO",
    "AUTOMATED",
    "BLOCKED",
    "Active catalog needs exact price, tax, and station routing.",
  ),
  check(
    "RECOVERY_EVIDENCE",
    "AUTOMATED",
    "BLOCKED",
    "Encrypted backup and isolated restore evidence exist.",
  ),
  check(
    "SECURITY_AND_SYNC_POSTURE",
    "AUTOMATED",
    "PASS",
    "Critical alerts, synchronization exceptions, and audit integrity are clear.",
  ),
  check(
    "PRIVACY_RETENTION_CONFIGURED",
    "AUTOMATED",
    "BLOCKED",
    "Required retention categories have approved active versions.",
  ),
  ...evidenceCodes.map((code) =>
    check(code, "EVIDENCE", "UNCONFIRMED", evidenceSummary(code)),
  ),
];
const demoReadiness = resultFromChecks(demoChecks, demoTime);
const demoEvidence: Evidence[] = [];
const demoReviews: Review[] = [
  {
    id: "demo-review-1",
    status: "BLOCKED",
    blockedCount: 4,
    unconfirmedCount: 13,
    passedCount: 3,
    reason: "Development readiness baseline.",
    recordedAt: demoTime,
  },
];

export function ReadinessShell({
  initialDemo = false,
}: {
  initialDemo?: boolean;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(
    initialDemo ? demoReadiness : null,
  );
  const [evidence, setEvidence] = useState<Evidence[]>(
    initialDemo ? demoEvidence : [],
  );
  const [reviews, setReviews] = useState<Review[]>(
    initialDemo ? demoReviews : [],
  );
  const [status, setStatus] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >(initialDemo ? "ready" : "loading");
  const [filter, setFilter] = useState<"ALL" | CheckStatus>("ALL");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState("");
  const [safeReference, setSafeReference] = useState("");
  const [evidenceCode, setEvidenceCode] = useState<
    (typeof evidenceCodes)[number]
  >("OWNER_SCOPE_APPROVED");
  const [evidenceOutcome, setEvidenceOutcome] =
    useState<Evidence["outcome"]>("CONFIRMED");
  const demo = initialDemo;

  const load = useCallback(async () => {
    if (initialDemo) {
      setReadiness(demoReadiness);
      setEvidence(demoEvidence);
      setReviews(demoReviews);
      setStatus("ready");
      return;
    }
    const token = window.sessionStorage.getItem("base-cafe-admin.access-token");
    if (!token) return void setStatus("signed-out");
    try {
      const [live, evidencePage, reviewPage] = await Promise.all([
        request<Readiness>("/operations/pilot-readiness", token),
        request<{ items: Evidence[] }>(
          "/operations/pilot-readiness/evidence?limit=20",
          token,
        ),
        request<{ items: Review[] }>(
          "/operations/pilot-readiness/reviews?limit=10",
          token,
        ),
      ]);
      setReadiness(live);
      setEvidence(evidencePage.items);
      setReviews(reviewPage.items);
      setStatus("ready");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        window.sessionStorage.removeItem("base-cafe-admin.access-token");
        setStatus("signed-out");
      } else {
        setStatus("error");
        setNotice(
          error instanceof Error
            ? error.message
            : "Readiness data could not be loaded.",
        );
      }
    }
  }, [initialDemo]);

  useEffect(() => {
    if (initialDemo) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [initialDemo, load]);

  const visibleChecks = useMemo(
    () =>
      readiness?.checks.filter(
        (item) => filter === "ALL" || item.status === filter,
      ) ?? [],
    [filter, readiness],
  );

  async function submit() {
    if (!modal || reason.trim().length < 3) return;
    if (demo) {
      if (modal === "evidence") {
        const now = new Date().toISOString();
        const item: Evidence = {
          id: crypto.randomUUID(),
          code: evidenceCode,
          outcome: evidenceOutcome,
          observedAt: now,
          safeReference: safeReference.trim() || null,
          reason: reason.trim(),
          recordedAt: now,
        };
        setEvidence((current) => [item, ...current]);
        setReadiness((current) =>
          current
            ? resultFromChecks(
                current.checks.map((entry) =>
                  entry.code === evidenceCode
                    ? {
                        ...entry,
                        status:
                          evidenceOutcome === "CONFIRMED" ? "PASS" : "BLOCKED",
                        evidenceId: item.id,
                        observedAt: now,
                      }
                    : entry,
                ),
              )
            : current,
        );
      } else if (readiness) {
        setReviews((current) => [
          {
            id: crypto.randomUUID(),
            status: readiness.status,
            blockedCount: readiness.counts.blocked,
            unconfirmedCount: readiness.counts.unconfirmed,
            passedCount: readiness.counts.passed,
            reason: reason.trim(),
            recordedAt: new Date().toISOString(),
          },
          ...current,
        ]);
      }
      setNotice(
        "Development preview updated locally; no server evidence was written.",
      );
      closeModal();
      return;
    }
    const token = window.sessionStorage.getItem("base-cafe-admin.access-token");
    if (!token) return void setStatus("signed-out");
    const path =
      modal === "evidence"
        ? "/operations/pilot-readiness/evidence"
        : "/operations/pilot-readiness/reviews";
    const body =
      modal === "evidence"
        ? {
            evidenceId: crypto.randomUUID(),
            code: evidenceCode,
            outcome: evidenceOutcome,
            observedAt: new Date().toISOString(),
            safeReference: safeReference.trim() || null,
            reason: reason.trim(),
          }
        : { reviewId: crypto.randomUUID(), reason: reason.trim() };
    try {
      await request(path, token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      closeModal();
      setNotice(
        modal === "evidence"
          ? "Readiness evidence recorded."
          : "Immutable review snapshot captured.",
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Readiness action failed.",
      );
    }
  }

  function closeModal() {
    setModal(null);
    setReason("");
    setSafeReference("");
  }

  return (
    <main className="security-app readiness-app">
      <aside className="security-rail">
        <div className="security-rail__brand">
          <Brand label="Base Cafe" />
          <small>ADMIN</small>
        </div>
        <nav aria-label="Admin navigation">
          {navItems.map((item) => (
            <Link
              className={item.href === "/readiness" ? "is-active" : ""}
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
          <Icon name="shift" size={17} /> Pilot control
        </span>
        <div className="security-topbar__space" />
        <span
          className={`security-health ${readiness?.status === "READY" ? "is-good" : ""}`}
        >
          <Icon name="audit" size={18} />{" "}
          {readiness?.status
            ? title(readiness.status)
            : "Authentication required"}
        </span>
        <span className="security-divider" />
        <span className="security-avatar">BA</span>
        <span>
          <strong>Authorized operator</strong>
          <small>Release console</small>
        </span>
      </header>

      <section className="security-content">
        <div className="security-titlebar">
          <div>
            <p className="security-eyebrow">RELEASE CONTROL</p>
            <h1>Pilot readiness</h1>
            <p>
              Separate live configuration checks from owner, provider, site, and
              drill evidence.
            </p>
          </div>
          <div className="readiness-actions">
            <button
              className="security-refresh"
              onClick={() => setModal("evidence")}
              type="button"
            >
              <Icon name="plus" size={17} /> Record evidence
            </button>
            <button
              className="security-refresh"
              onClick={() => void load()}
              type="button"
            >
              <Icon name="recall" size={17} /> Refresh
            </button>
          </div>
        </div>
        {demo && (
          <div className="security-demo">
            Development preview — the launch gate is intentionally blocked and
            all actions remain local.
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
        {status === "loading" && (
          <div className="security-loading">
            Loading protected readiness data…
          </div>
        )}
        {status === "signed-out" && (
          <StateCard
            title="Authenticated admin session required"
            text="Sign in through the approved admin flow with organization-scoped release access."
          />
        )}
        {status === "error" && (
          <StateCard
            title="Readiness data is unavailable"
            text="Use Refresh after the API connection has recovered. Stale gate results are never presented as current."
            error
          />
        )}

        {status === "ready" && readiness && (
          <>
            <div className="security-metrics">
              <Metric
                icon="audit"
                tone={readiness.status === "READY" ? "good" : "danger"}
                label="Gate status"
                value={title(readiness.status)}
                note={formatTime(readiness.generatedAt)}
              />
              <Metric
                icon="audit"
                tone="danger"
                label="Blocked"
                value={String(readiness.counts.blocked)}
                note="Must be resolved"
              />
              <Metric
                icon="clock"
                tone="warn"
                label="Unconfirmed"
                value={String(readiness.counts.unconfirmed)}
                note="Evidence required"
              />
              <Metric
                icon="shift"
                tone="good"
                label="Passed"
                value={String(readiness.counts.passed)}
                note="Current checks"
              />
            </div>

            <div className="readiness-grid">
              <section className="security-card readiness-checks">
                <header>
                  <div>
                    <h2>Launch gates</h2>
                    <p>Live facts and latest append-only evidence</p>
                  </div>
                  <select
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as typeof filter)
                    }
                  >
                    <option value="ALL">All checks</option>
                    <option value="BLOCKED">Blocked</option>
                    <option value="UNCONFIRMED">Unconfirmed</option>
                    <option value="PASS">Passed</option>
                  </select>
                </header>
                <div className="security-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Check</th>
                        <th>Basis</th>
                        <th>Status</th>
                        <th>Observed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleChecks.map((item) => (
                        <tr key={item.code}>
                          <td>
                            <strong>
                              {title(item.code.split(":")[0] ?? item.code)}
                            </strong>
                            <small>{item.summary}</small>
                          </td>
                          <td>{title(item.category)}</td>
                          <td>
                            <Status value={item.status} />
                          </td>
                          <td>
                            {item.observedAt
                              ? formatTime(item.observedAt)
                              : item.category === "AUTOMATED"
                                ? "Live"
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="security-card readiness-evidence">
                <header>
                  <div>
                    <h2>Latest evidence</h2>
                    <p>No sensitive document contents</p>
                  </div>
                  <span className="security-count">
                    {evidence.length} records
                  </span>
                </header>
                {evidence.slice(0, 6).map((item) => (
                  <div className="readiness-evidence-row" key={item.id}>
                    <div>
                      <strong>{title(item.code)}</strong>
                      <small>
                        {item.safeReference ?? "Restricted evidence package"}
                      </small>
                    </div>
                    <Status value={item.outcome} />
                  </div>
                ))}
                {evidence.length === 0 && (
                  <p className="readiness-empty">
                    No external evidence recorded.
                  </p>
                )}
              </aside>
            </div>

            <section className="security-card readiness-reviews">
              <header>
                <div>
                  <h2>Review snapshots</h2>
                  <p>Immutable point-in-time launch decisions</p>
                </div>
                <button
                  className="security-action"
                  onClick={() => setModal("review")}
                  type="button"
                >
                  Capture review
                </button>
              </header>
              <div className="security-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Captured</th>
                      <th>Status</th>
                      <th>Passed</th>
                      <th>Blocked</th>
                      <th>Unconfirmed</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.map((review) => (
                      <tr key={review.id}>
                        <td>{formatTime(review.recordedAt)}</td>
                        <td>
                          <Status value={review.status} />
                        </td>
                        <td>{review.passedCount}</td>
                        <td>{review.blockedCount}</td>
                        <td>{review.unconfirmedCount}</td>
                        <td className="security-reason">{review.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </section>

      {modal && (
        <div className="security-modal" role="presentation">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="security-eyebrow">CONTROLLED RELEASE ACTION</p>
            <h2>
              {modal === "evidence"
                ? "Record readiness evidence"
                : "Capture readiness review"}
            </h2>
            <p>
              {modal === "evidence"
                ? "Append the latest reviewed outcome. Do not include secrets, customer data, or document contents."
                : "Preserve the current gate result without waiving or changing any blocker."}
            </p>
            {modal === "evidence" && (
              <div className="readiness-form-grid">
                <label>
                  Evidence type
                  <select
                    value={evidenceCode}
                    onChange={(event) =>
                      setEvidenceCode(event.target.value as typeof evidenceCode)
                    }
                  >
                    {evidenceCodes.map((code) => (
                      <option key={code} value={code}>
                        {title(code)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Outcome
                  <select
                    value={evidenceOutcome}
                    onChange={(event) =>
                      setEvidenceOutcome(
                        event.target.value as Evidence["outcome"],
                      )
                    }
                  >
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="FAILED">Failed</option>
                    <option value="REVOKED">Revoked</option>
                  </select>
                </label>
                <label className="is-wide">
                  Safe reference
                  <input
                    maxLength={240}
                    onChange={(event) => setSafeReference(event.target.value)}
                    placeholder="Restricted document or drill ID"
                    value={safeReference}
                  />
                </label>
              </div>
            )}
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
              <button onClick={closeModal} type="button">
                Cancel
              </button>
              <button
                className="is-danger"
                disabled={reason.trim().length < 3}
                type="submit"
              >
                {modal === "evidence" ? "Record evidence" : "Capture review"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function check(
  code: string,
  category: Check["category"],
  status: CheckStatus,
  summary: string,
): Check {
  return { code, category, status, summary };
}
function resultFromChecks(
  checks: Check[],
  generatedAt = new Date().toISOString(),
): Readiness {
  const blocked = checks.filter((item) => item.status === "BLOCKED").length;
  const unconfirmed = checks.filter(
    (item) => item.status === "UNCONFIRMED",
  ).length;
  return {
    generatedAt,
    status: blocked ? "BLOCKED" : unconfirmed ? "UNCONFIRMED" : "READY",
    counts: {
      blocked,
      unconfirmed,
      passed: checks.length - blocked - unconfirmed,
    },
    blockingCodes: checks
      .filter((item) => item.status === "BLOCKED")
      .map((item) => item.code),
    unconfirmedCodes: checks
      .filter((item) => item.status === "UNCONFIRMED")
      .map((item) => item.code),
    checks,
  };
}
function evidenceSummary(code: string) {
  return `${title(code)} requires reviewed external evidence.`;
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
function StateCard({
  error = false,
  text,
  title: heading,
}: {
  error?: boolean;
  text: string;
  title: string;
}) {
  return (
    <div className={`security-auth-card ${error ? "is-error" : ""}`}>
      <Icon name={error ? "wifi" : "audit"} size={32} />
      <div>
        <h2>{heading}</h2>
        <p>{text}</p>
      </div>
    </div>
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
