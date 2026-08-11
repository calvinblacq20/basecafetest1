"use client";

import type {
  DailySummaryResponse,
  ReportExceptionsResponse,
  ReportExportDataset,
  SalesBreakdownResponse,
  SalesReportGrouping,
  ShiftReconciliationResponse,
  TaxSummaryResponse,
  TenderSummaryResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { useCallback, useEffect, useState } from "react";

import {
  downloadReportCsv,
  getDailySummary,
  getReportExceptions,
  getSalesBreakdown,
  getShiftReconciliation,
  getTaxSummary,
  getTenderSummary,
  type AdminSession,
} from "./admin-client";

type ReportView =
  "summary" | "sales" | "tenders" | "tax" | "shifts" | "exceptions";

type ReportBundle = {
  daily: DailySummaryResponse;
  sales: SalesBreakdownResponse;
  tenders: TenderSummaryResponse;
  tax: TaxSummaryResponse;
  shifts: ShiftReconciliationResponse;
  exceptions: ReportExceptionsResponse;
};

const exportDatasets: ReportExportDataset[] = [
  "DAILY_SUMMARY",
  "SALES_LINES",
  "TENDERS",
  "TAX_COMPONENTS",
  "SHIFT_RECONCILIATION",
  "REFUNDS",
  "EXCEPTIONS",
];

const groupingLabels: Record<SalesReportGrouping, string> = {
  CHANNEL: "Channel",
  ITEM: "Item",
  CATEGORY: "Category snapshot",
  COMPLETION_HOUR: "Completion hour",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "Reports could not be loaded.";
}

function formatMoney(value: number | bigint) {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? "−" : ""}GH₵${absolute / 100n}.${String(
    absolute % 100n,
  ).padStart(2, "0")}`;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function formatTimestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: timezone,
  }).format(new Date(value));
}

function Metadata({
  report,
}: {
  report: Pick<DailySummaryResponse, "metadata">;
}) {
  const metadata = report.metadata;
  return (
    <footer className="report-metadata">
      <span>
        Generated {formatTimestamp(metadata.generatedAt, metadata.timezone)} ·{" "}
        {metadata.timezone}
      </span>
      <span>Basis: {metadata.basis.join(" + ")}</span>
    </footer>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="live-empty report-empty">{children}</p>;
}

export function ManagementReports({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<ReportView>("summary");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [groupBy, setGroupBy] = useState<SalesReportGrouping>("CHANNEL");
  const [query, setQuery] = useState(() => ({
    fromDate: today(),
    toDate: today(),
    groupBy: "CHANNEL" as SalesReportGrouping,
  }));
  const [dataset, setDataset] = useState<ReportExportDataset>("DAILY_SUMMARY");
  const [reports, setReports] = useState<ReportBundle | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "denied" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const canRead = session.user.permissions.includes("reports.read");
  const canExport = session.user.permissions.includes("reports.export");

  const load = useCallback(async () => {
    if (!canRead) {
      setStatus("denied");
      setMessage("The current session does not have reports.read.");
      return;
    }
    setStatus("loading");
    setMessage("");
    setReports(null);
    const range = { fromDate: query.fromDate, toDate: query.toDate };
    try {
      const [daily, sales, tenders, tax, shifts, exceptions] =
        await Promise.all([
          getDailySummary(session, range),
          getSalesBreakdown(session, range, query.groupBy),
          getTenderSummary(session, range),
          getTaxSummary(session, range),
          getShiftReconciliation(session, range),
          getReportExceptions(session, range),
        ]);
      setReports({ daily, sales, tenders, tax, shifts, exceptions });
      setStatus("ready");
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 403 ? "denied" : "error",
      );
      setMessage(errorMessage(error));
    }
  }, [canRead, query, session]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
    };
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const filename = await downloadReportCsv(session, dataset, {
        fromDate: query.fromDate,
        toDate: query.toDate,
      });
      notify(`Audited CSV downloaded: ${filename}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  const daily = reports?.daily;
  const gross = daily ? sum(daily.rows.map((row) => row.grossSalesMinor)) : 0n;
  const refunds = daily
    ? sum(daily.rows.map((row) => row.confirmedRefundsMinor))
    : 0n;
  const orderCount = daily
    ? daily.rows.reduce((total, row) => total + row.completedOrderCount, 0)
    : 0;

  return (
    <section className="management-reports">
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Live immutable snapshots</p>
          <h1>Management reports</h1>
          <p>
            Sales, tender, refund and shift bases remain separate and explicit.
            Customer and payment-reference data is excluded.
          </p>
        </div>
        <button className="live-primary" onClick={() => void load()}>
          Refresh reports
        </button>
      </header>

      <section className="report-controls" aria-label="Report range and export">
        <label>
          From date
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
        <label>
          Sales grouping
          <select
            value={groupBy}
            onChange={(event) =>
              setGroupBy(event.target.value as SalesReportGrouping)
            }
          >
            {Object.entries(groupingLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setQuery({ fromDate, toDate, groupBy })}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Loading…" : "Apply range"}
        </button>
        {canExport ? (
          <div className="report-export-control">
            <label>
              CSV dataset
              <select
                value={dataset}
                onChange={(event) =>
                  setDataset(event.target.value as ReportExportDataset)
                }
              >
                {exportDatasets.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button disabled={exporting} onClick={() => void exportCsv()}>
              {exporting ? "Preparing…" : "Download audited CSV"}
            </button>
          </div>
        ) : null}
      </section>

      {status === "denied" || status === "error" ? (
        <div className="live-blocker">
          <strong>
            {status === "denied"
              ? "Reporting permission required"
              : "Reports could not be loaded"}
          </strong>
          <p>{message}</p>
        </div>
      ) : null}

      <nav className="config-tabs report-tabs" aria-label="Report dataset">
        {(
          [
            ["summary", "Daily summary"],
            ["sales", "Sales breakdown"],
            ["tenders", "Tenders"],
            ["tax", "Tax"],
            ["shifts", "Shift cash"],
            ["exceptions", "Exceptions"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={view === value ? "is-active" : ""}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {daily && view === "summary" ? (
        <article className="report-panel">
          <section className="report-kpis">
            <div>
              <span>Completed orders</span>
              <strong>{orderCount}</strong>
            </div>
            <div>
              <span>Gross sales</span>
              <strong>{formatMoney(gross)}</strong>
            </div>
            <div>
              <span>Confirmed refunds</span>
              <strong>{formatMoney(refunds)}</strong>
            </div>
            <div>
              <span>Commercial net</span>
              <strong>{formatMoney(gross - refunds)}</strong>
            </div>
          </section>
          <div className="live-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Business date</th>
                  <th>Orders</th>
                  <th>Net before tax</th>
                  <th>Tax</th>
                  <th>Gross</th>
                  <th>Refunds</th>
                </tr>
              </thead>
              <tbody>
                {daily.rows.map((row) => (
                  <tr key={row.businessDate}>
                    <td>{row.businessDate}</td>
                    <td>{row.completedOrderCount}</td>
                    <td>{formatMoney(row.netTotalMinor)}</td>
                    <td>{formatMoney(row.taxTotalMinor)}</td>
                    <td>{formatMoney(row.grossSalesMinor)}</td>
                    <td>{formatMoney(row.confirmedRefundsMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Metadata report={daily} />
        </article>
      ) : null}

      {reports && view === "sales" ? (
        <article className="report-panel">
          <header className="report-panel__heading">
            <div>
              <p className="live-eyebrow">
                {groupingLabels[reports.sales.groupBy]}
              </p>
              <h2>Completed sales breakdown</h2>
            </div>
            <span>{reports.sales.rows.length} groups</span>
          </header>
          {reports.sales.rows.length ? (
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Orders</th>
                    <th>Quantity</th>
                    <th>Net</th>
                    <th>Tax</th>
                    <th>Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.sales.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.orderCount}</td>
                      <td>{row.quantity}</td>
                      <td>{formatMoney(row.netTotalMinor)}</td>
                      <td>{formatMoney(row.taxTotalMinor)}</td>
                      <td>{formatMoney(row.grossTotalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No completed sales exist in this range.</Empty>
          )}
          <Metadata report={reports.sales} />
        </article>
      ) : null}

      {reports && view === "tenders" ? (
        <article className="report-panel">
          <header className="report-panel__heading">
            <div>
              <p className="live-eyebrow">Confirmation local date</p>
              <h2>Confirmed tenders and refunds</h2>
            </div>
          </header>
          {reports.tenders.rows.length ? (
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Activity date</th>
                    <th>Method</th>
                    <th>Payments</th>
                    <th>Confirmed</th>
                    <th>Refunded</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.tenders.rows.map((row) => (
                    <tr key={`${row.activityDate}:${row.method}`}>
                      <td>{row.activityDate}</td>
                      <td>{row.method}</td>
                      <td>{row.paymentCount}</td>
                      <td>{formatMoney(row.confirmedMinor)}</td>
                      <td>{formatMoney(row.refundedMinor)}</td>
                      <td>{formatMoney(row.netMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No confirmed tenders or refunds exist in this range.</Empty>
          )}
          <Metadata report={reports.tenders} />
        </article>
      ) : null}

      {reports && view === "tax" ? (
        <article className="report-panel">
          <div className="live-blocker report-note">
            <strong>Refund tax allocation is unavailable</strong>
            <p>
              This report contains immutable gross-sale tax components only.
              Refunds remain separate until the accountant/GRA procedure is
              confirmed.
            </p>
          </div>
          {reports.tax.rows.length ? (
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Component</th>
                    <th>Rate</th>
                    <th>Treatment</th>
                    <th>Taxable base</th>
                    <th>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.tax.rows.map((row) => (
                    <tr
                      key={`${row.businessDate}:${row.code}:${row.ratePpm}:${row.treatment}`}
                    >
                      <td>{row.businessDate}</td>
                      <td>
                        {row.label} <small>{row.code}</small>
                      </td>
                      <td>{(row.ratePpm / 10_000).toFixed(2)}%</td>
                      <td>{row.treatment}</td>
                      <td>{formatMoney(row.taxableBaseMinor)}</td>
                      <td>{formatMoney(row.taxMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No sale tax components exist in this range.</Empty>
          )}
          <Metadata report={reports.tax} />
        </article>
      ) : null}

      {reports && view === "shifts" ? (
        <article className="report-panel">
          {reports.shifts.rows.length ? (
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date / shift</th>
                    <th>Opening</th>
                    <th>Cash sales</th>
                    <th>Cash refunds</th>
                    <th>Expected</th>
                    <th>Counted</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.shifts.rows.map((row) => (
                    <tr key={row.shiftId}>
                      <td>
                        {row.businessDate}
                        <small>{row.shiftId.slice(0, 8)}…</small>
                      </td>
                      <td>{formatMoney(row.openingFloatMinor)}</td>
                      <td>{formatMoney(row.confirmedCashPaymentsMinor)}</td>
                      <td>{formatMoney(row.confirmedCashRefundsMinor)}</td>
                      <td>{formatMoney(row.recomputedExpectedCashMinor)}</td>
                      <td>
                        {row.countedCashMinor === null
                          ? "Open"
                          : formatMoney(row.countedCashMinor)}
                      </td>
                      <td>
                        <span
                          className={`live-status live-status--${row.reconciliationStatus.toLowerCase()}`}
                        >
                          {row.reconciliationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No shifts exist in this business-date range.</Empty>
          )}
          <Metadata report={reports.shifts} />
        </article>
      ) : null}

      {reports && view === "exceptions" ? (
        <article className="report-panel">
          <header className="report-panel__heading">
            <div>
              <p className="live-eyebrow">No threshold suppression</p>
              <h2>Operational exceptions</h2>
            </div>
            <span>{reports.exceptions.rows.length} visible</span>
          </header>
          {reports.exceptions.rows.length ? (
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.exceptions.rows.map((row) => (
                    <tr key={`${row.type}:${row.id}`}>
                      <td>
                        {formatTimestamp(
                          row.occurredAt,
                          reports.exceptions.metadata.timezone,
                        )}
                      </td>
                      <td>{row.type}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.amountMinor === null
                          ? "—"
                          : formatMoney(row.amountMinor)}
                      </td>
                      <td>{row.reference ?? row.id.slice(0, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No reportable exceptions exist in this range.</Empty>
          )}
          <Metadata report={reports.exceptions} />
        </article>
      ) : null}

      {status === "loading" && !reports ? (
        <div className="report-loading">Loading live reports…</div>
      ) : null}
    </section>
  );
}
