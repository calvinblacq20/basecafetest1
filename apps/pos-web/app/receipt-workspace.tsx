"use client";

import type {
  PrintJobResponse,
  ReceiptDetailResponse,
  ReceiptHistoryItem,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { Icon } from "@base-cafe/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";
import {
  getReceiptDetail,
  listReceipts,
  queueReceiptReprint,
  renderReceipt,
  retryPrintJob,
} from "./receipt-recovery-client";

type Action =
  { kind: "REPRINT" } | { kind: "RETRY"; printJob: PrintJobResponse };

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "RECEIPT_ACTION_FAILED";
  const messages: Record<string, string> = {
    RECEIPT_HISTORY_REQUIRES_CONNECTION:
      "Receipt history requires an online connection.",
    RECEIPT_REPRINT_REQUIRES_CONNECTION:
      "Reprints require an online connection.",
    PRINT_JOB_RETRY_REQUIRES_CONNECTION:
      "Print-job retry requires an online connection.",
    PRINT_JOB_NOT_RETRYABLE: "Only failed print jobs can be retried.",
    STALE_REVISION: "The print job changed. Its latest state has been loaded.",
  };
  return messages[code] ?? code.replaceAll("_", " ");
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function ReceiptWorkspace({ runtime }: { runtime: CashierRuntime }) {
  const [items, setItems] = useState<ReceiptHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetailResponse | null>(null);
  const [html, setHtml] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const permissions = runtime.session.user.permissions;

  const loadDetail = useCallback(
    async (receiptId: string) => {
      setBusy(true);
      try {
        const [record, rendered] = await Promise.all([
          getReceiptDetail(runtime.session, receiptId),
          renderReceipt(runtime.session, receiptId),
        ]);
        setSelectedId(receiptId);
        setDetail(record);
        setHtml(rendered);
        setNotice(null);
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [runtime],
  );

  const load = useCallback(
    async (query = "", preferredId?: string | null) => {
      setLoading(true);
      try {
        const response = await listReceipts(runtime.session, query);
        setItems(response.items);
        const nextId =
          (preferredId && response.items.some((item) => item.id === preferredId)
            ? preferredId
            : response.items[0]?.id) ?? null;
        if (nextId) await loadDetail(nextId);
        else {
          setSelectedId(null);
          setDetail(null);
          setHtml("");
        }
        setNotice(null);
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [loadDetail, runtime],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submitAction() {
    if (!detail || !action || !reason.trim()) {
      setNotice("A reason is required for this audited action.");
      return;
    }
    setBusy(true);
    try {
      if (action.kind === "REPRINT") {
        const rendered = await queueReceiptReprint(
          runtime.session,
          detail.id,
          reason.trim(),
        );
        setHtml(rendered);
        window.setTimeout(() => frame.current?.contentWindow?.print(), 100);
        setNotice("Reprint queued. The browser print dialog is opening.");
      } else {
        await retryPrintJob(runtime.session, action.printJob, reason.trim());
        setNotice(
          "Failed print job returned to the queue for the configured print worker.",
        );
      }
      setAction(null);
      setReason("");
      await load(search, detail.id);
    } catch (error) {
      setNotice(errorMessage(error));
      if (error instanceof Error && error.message === "STALE_REVISION")
        await load(search, detail.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="receipt-workspace" aria-label="Receipt history">
      <header className="workspace-heading receipt-workspace__heading">
        <div>
          <span>Immutable commercial documents</span>
          <h1>Receipts &amp; print queue</h1>
          <p>
            Reprints append history. Failed jobs may be returned to the queue;
            no receipt or payment is recreated.
          </p>
        </div>
        <form
          className="receipt-search"
          onSubmit={(event) => {
            event.preventDefault();
            void load(search, selectedId);
          }}
        >
          <Icon name="search" size={18} />
          <input
            aria-label="Search receipt or order number"
            maxLength={80}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Receipt or order number"
            value={search}
          />
          <button className="button button--outline" type="submit">
            Search
          </button>
        </form>
      </header>

      {notice ? (
        <div className="workspace-notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="receipt-workspace__grid">
        <aside className="receipt-ledger" aria-label="Receipt list">
          <div className="receipt-ledger__summary">
            <strong>{items.length} receipts</strong>
            <button
              className="link-button"
              disabled={loading}
              onClick={() => void load(search, selectedId)}
              type="button"
            >
              Refresh
            </button>
          </div>
          {loading && !items.length ? <p>Loading receipt history…</p> : null}
          {!loading && !items.length ? (
            <div className="workspace-empty">
              <Icon name="orders" size={30} />
              <strong>No matching receipts</strong>
              <span>
                Completed sales will appear here after receipt creation.
              </span>
            </div>
          ) : null}
          <div className="receipt-ledger__items">
            {items.map((item) => (
              <button
                aria-current={item.id === selectedId ? "true" : undefined}
                className={
                  item.id === selectedId
                    ? "receipt-row is-selected"
                    : "receipt-row"
                }
                key={item.id}
                onClick={() => void loadDetail(item.id)}
                type="button"
              >
                <span>
                  <strong>{item.receiptNumber}</strong>
                  <small>Order {item.orderNumber}</small>
                </span>
                <span className="receipt-row__amount">
                  <strong>
                    {item.totalMinor === null
                      ? "Unsnapped"
                      : formatMoney(money(item.totalMinor))}
                  </strong>
                  <small>{item.businessDate}</small>
                </span>
                <span className="receipt-row__status">
                  <small>{statusLabel(item.fiscalStatus)}</small>
                  <small>
                    {item.latestPrintJob
                      ? `Print ${statusLabel(item.latestPrintJob.status)}`
                      : "No print job"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="receipt-detail">
          {detail ? (
            <>
              <div className="receipt-detail__toolbar">
                <div>
                  <span className="non-fiscal-badge">NOT A FISCAL RECEIPT</span>
                  <h2>{detail.receiptNumber}</h2>
                  <p>
                    Order {detail.orderNumber} · {timestamp(detail.createdAt)}
                  </p>
                </div>
                <div className="receipt-detail__actions">
                  <button
                    className="button button--outline"
                    disabled={busy}
                    onClick={() => frame.current?.contentWindow?.print()}
                    type="button"
                  >
                    Browser print
                  </button>
                  {permissions.includes("receipts.reprint") ? (
                    <button
                      className="button button--primary"
                      disabled={busy}
                      onClick={() => {
                        setAction({ kind: "REPRINT" });
                        setReason("");
                      }}
                      type="button"
                    >
                      Reprint
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="receipt-detail__content">
                <iframe
                  className="receipt-history-frame"
                  ref={frame}
                  sandbox="allow-modals allow-same-origin"
                  srcDoc={html}
                  title={`Receipt ${detail.receiptNumber}`}
                />
                <section className="print-history" aria-label="Print history">
                  <div>
                    <span>Document total</span>
                    <strong>
                      {detail.totalMinor === null
                        ? "Unavailable"
                        : formatMoney(money(detail.totalMinor))}
                    </strong>
                  </div>
                  <div>
                    <span>Reprints</span>
                    <strong>{detail.reprintCount}</strong>
                  </div>
                  <h3>Print jobs</h3>
                  {!detail.printJobs.length ? (
                    <p>No persistent print jobs have been queued.</p>
                  ) : null}
                  {detail.printJobs.map((job) => (
                    <article className="print-job" key={job.id}>
                      <div>
                        <strong>{statusLabel(job.status)}</strong>
                        <small>
                          Attempt {job.attemptCount} · revision {job.revision}
                        </small>
                      </div>
                      <small>{timestamp(job.updatedAt)}</small>
                      {job.errorCode ? (
                        <span className="print-job__error">
                          {statusLabel(job.errorCode)}
                        </span>
                      ) : null}
                      {job.status === "FAILED" &&
                      permissions.includes("print-jobs.manage") ? (
                        <button
                          className="link-button"
                          onClick={() => {
                            setAction({ kind: "RETRY", printJob: job });
                            setReason("");
                          }}
                          type="button"
                        >
                          Return to queue
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              </div>
            </>
          ) : (
            <div className="workspace-empty workspace-empty--large">
              <Icon name="orders" size={38} />
              <strong>Select a receipt</strong>
              <span>Its immutable commercial rendering appears here.</span>
            </div>
          )}
        </main>
      </div>

      {action ? (
        <div className="workspace-action-sheet" role="dialog" aria-modal="true">
          <div>
            <span>Audited action</span>
            <h2>
              {action.kind === "REPRINT"
                ? "Queue a receipt reprint"
                : "Retry failed print job"}
            </h2>
            <p>
              {action.kind === "REPRINT"
                ? "This appends reprint and print-job history. It does not create a new sale."
                : "This returns the same immutable job to QUEUED. A configured print worker must process it."}
            </p>
            <label>
              Reason
              <textarea
                autoFocus
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <div className="workspace-action-sheet__buttons">
              <button
                className="button button--outline"
                onClick={() => setAction(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={busy || !reason.trim()}
                onClick={() => void submitAction()}
                type="button"
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
