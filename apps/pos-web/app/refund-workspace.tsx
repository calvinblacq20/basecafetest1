"use client";

import type {
  PaymentResponse,
  RefundKind,
  RefundListResponse,
  RefundResponse,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { Icon } from "@base-cafe/ui";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";

const tenderLabels = {
  CASH: "Cash",
  MANUAL_MOMO: "Manual MoMo",
  EXTERNAL_CARD: "External terminal",
  BANK_TRANSFER: "Bank transfer",
} as const;

const kindLabels: Record<RefundKind, string> = {
  REFUND: "Refund",
  REVERSAL: "Reversal",
  CHARGEBACK: "Chargeback",
  DISPUTE: "Dispute",
};

function message(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "REFUND_ACTION_FAILED";
  const labels: Record<string, string> = {
    ORDER_NOT_SETTLED: "Only a completed sale can be refunded.",
    REFUND_EXCEEDS_REFUNDABLE:
      "The amount exceeds the unreserved refundable balance.",
    REFUND_SELF_APPROVAL_FORBIDDEN:
      "A different authorized user must approve this request.",
    REFUND_RESOLUTION_SEPARATION_REQUIRED:
      "Provider resolution requires a third authorized user.",
    STALE_REVISION: "This refund changed. Refresh and review it again.",
    REFUND_SHIFT_NOT_OPEN: "Open a device shift before requesting a refund.",
    REFUND_REQUEST_REQUIRES_CONNECTION: "Refund requests are online-only.",
  };
  return labels[code] ?? code.replaceAll("_", " ");
}

function orderNumber(payment: PaymentResponse) {
  return payment.allocations[0]?.order.orderNumber ?? "Order unavailable";
}

export function RefundWorkspace({
  runtime,
  shiftId,
}: {
  runtime: CashierRuntime;
  shiftId: string | null;
}) {
  const [payments, setPayments] = useState<PaymentResponse[]>([]);
  const [refunds, setRefunds] = useState<RefundListResponse>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(
    null,
  );
  const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = runtime.session.user.permissions;
  const currentUserId = runtime.session.scope.userId;

  const reload = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [paymentList, refundList] = await Promise.all([
        runtime.listOrderPayments(),
        runtime.listRefunds(),
      ]);
      const confirmed = paymentList.filter(
        (payment) => payment.status === "CONFIRMED",
      );
      setPayments(confirmed);
      setRefunds(refundList);
      setSelectedPaymentId((current) => current ?? confirmed[0]?.id ?? null);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const reservedByPayment = useMemo(() => {
    const result = new Map<string, number>();
    for (const refund of refunds) {
      if (
        ["AWAITING_APPROVAL", "PENDING_PROVIDER", "CONFIRMED"].includes(
          refund.status,
        )
      )
        result.set(
          refund.paymentId,
          (result.get(refund.paymentId) ?? 0) + refund.amountMinor,
        );
    }
    return result;
  }, [refunds]);
  const selectedPayment = payments.find(
    (payment) => payment.id === selectedPaymentId,
  );
  const selectedRefund = refunds.find(
    (refund) => refund.id === selectedRefundId,
  );
  const totalOriginal = payments.reduce(
    (sum, payment) => sum + payment.amountMinor,
    0,
  );
  const totalReserved = refunds
    .filter((refund) =>
      ["AWAITING_APPROVAL", "PENDING_PROVIDER"].includes(refund.status),
    )
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  const totalConfirmed = refunds
    .filter((refund) => refund.status === "CONFIRMED")
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  const totalRefundable = Math.max(
    totalOriginal -
      refunds
        .filter((refund) =>
          ["AWAITING_APPROVAL", "PENDING_PROVIDER", "CONFIRMED"].includes(
            refund.status,
          ),
        )
        .reduce((sum, refund) => sum + refund.amountMinor, 0),
    0,
  );

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!selectedPayment || !shiftId) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = Math.round(Number(data.get("amount")) * 100);
    const kind = String(data.get("kind")) as RefundKind;
    const evidenceNote = String(data.get("evidenceNote") ?? "").trim();
    const reason = String(data.get("reason") ?? "").trim();
    const available = Math.max(
      selectedPayment.amountMinor -
        (reservedByPayment.get(selectedPayment.id) ?? 0),
      0,
    );
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return setNotice("Enter a valid refund amount.");
    if (amountMinor > available)
      return setNotice("The amount exceeds the refundable balance.");
    if (!evidenceNote || !reason)
      return setNotice("Evidence and an audit reason are required.");
    setBusy(true);
    try {
      const created = await runtime.requestRefund(selectedPayment, shiftId, {
        kind,
        amountMinor,
        evidenceNote,
        reason,
      });
      setSelectedRefundId(created.id);
      await reload();
      setNotice("Refund request awaits independent approval.");
      form.reset();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRefund) return;
    const data = new FormData(event.currentTarget);
    const evidence = String(data.get("approvalEvidence") ?? "").trim();
    const reason = String(data.get("approvalReason") ?? "").trim();
    const decision = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value as "APPROVE" | "REJECT";
    if (!evidence || !reason)
      return setNotice("Evidence and an audit reason are required.");
    setBusy(true);
    try {
      await runtime.approveRefund(selectedRefund, decision, evidence, reason);
      await reload();
      setNotice(
        decision === "REJECT"
          ? "Refund request rejected with retained history."
          : selectedRefund.payment.method === "CASH"
            ? "Cash refund independently approved and confirmed."
            : "Refund approved; provider resolution is still required.",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRefund) return;
    const data = new FormData(event.currentTarget);
    const providerReference = String(
      data.get("providerReference") ?? "",
    ).trim();
    const evidence = String(data.get("resolutionEvidence") ?? "").trim();
    const reason = String(data.get("resolutionReason") ?? "").trim();
    const outcome = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value as "CONFIRMED" | "FAILED";
    if (!providerReference || !evidence || !reason)
      return setNotice(
        "Provider reference, evidence, and an audit reason are required.",
      );
    setBusy(true);
    try {
      await runtime.resolveRefund(
        selectedRefund,
        outcome,
        providerReference,
        evidence,
        reason,
      );
      await reload();
      setNotice(
        outcome === "CONFIRMED"
          ? "External refund resolution confirmed."
          : "External refund resolution recorded as failed.",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="refund-workspace" aria-label="Refunds and reversals">
      <header className="refund-workspace__header">
        <div>
          <h1>Refunds &amp; reversals</h1>
          <p>Online-only · independent approval · immutable audit history</p>
        </div>
        <button disabled={loading} onClick={() => void reload()} type="button">
          <Icon name="recall" size={19} /> Refresh
        </button>
      </header>

      <div className="refund-metrics" aria-label="Refund totals">
        {[
          ["Original tender", totalOriginal],
          ["Refundable", totalRefundable],
          ["Reserved", totalReserved],
          ["Confirmed refunded", totalConfirmed],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{formatMoney(money(value as number))}</strong>
          </div>
        ))}
      </div>

      <div className="refund-layout">
        <div className="refund-ledger">
          <section>
            <div className="refund-section-heading">
              <div>
                <span>Eligible source records</span>
                <h2>Confirmed tenders</h2>
              </div>
              <small>Settlement is rechecked by the server</small>
            </div>
            <div className="refund-payment-list">
              {payments.map((payment) => {
                const reserved = reservedByPayment.get(payment.id) ?? 0;
                const available = Math.max(payment.amountMinor - reserved, 0);
                return (
                  <button
                    aria-pressed={selectedPaymentId === payment.id}
                    className={
                      selectedPaymentId === payment.id ? "is-selected" : ""
                    }
                    key={payment.id}
                    onClick={() => {
                      setSelectedPaymentId(payment.id);
                      setSelectedRefundId(null);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{orderNumber(payment)}</strong>
                      <small>{tenderLabels[payment.method]}</small>
                    </span>
                    <span>
                      <strong>{formatMoney(money(payment.amountMinor))}</strong>
                      <small>Refundable {formatMoney(money(available))}</small>
                    </span>
                  </button>
                );
              })}
              {!loading && payments.length === 0 ? (
                <div className="refund-empty">
                  <strong>No confirmed tenders</strong>
                  <span>Complete a paid order before requesting a refund.</span>
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="refund-section-heading">
              <div>
                <span>Append-only lifecycle</span>
                <h2>Refund history</h2>
              </div>
            </div>
            <div className="refund-history">
              {refunds.map((refund) => (
                <button
                  aria-pressed={selectedRefundId === refund.id}
                  className={
                    selectedRefundId === refund.id ? "is-selected" : ""
                  }
                  key={refund.id}
                  onClick={() => {
                    setSelectedRefundId(refund.id);
                    setSelectedPaymentId(refund.paymentId);
                  }}
                  type="button"
                >
                  <span>
                    <strong>{refund.order.orderNumber}</strong>
                    <small>
                      {kindLabels[refund.kind]} ·{" "}
                      {refund.requestedByDisplayName}
                    </small>
                  </span>
                  <span>
                    <strong>{formatMoney(money(refund.amountMinor))}</strong>
                    <small data-status={refund.status}>
                      {refund.status === "AWAITING_APPROVAL"
                        ? "Awaiting independent approval"
                        : refund.status.replaceAll("_", " ")}
                    </small>
                  </span>
                </button>
              ))}
              {!loading && refunds.length === 0 ? (
                <div className="refund-empty">
                  <strong>No refund history</strong>
                  <span>
                    Requests will appear here without deleting history.
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="refund-action-panel">
          {selectedRefund ? (
            <RefundReview
              busy={busy}
              canApprove={permissions.includes("refunds.approve")}
              canResolve={permissions.includes("refunds.resolve")}
              currentUserId={currentUserId}
              refund={selectedRefund}
              onApprove={approve}
              onResolve={resolve}
            />
          ) : selectedPayment ? (
            <RefundRequest
              busy={busy}
              canRequest={permissions.includes("refunds.request")}
              payment={selectedPayment}
              refundableMinor={Math.max(
                selectedPayment.amountMinor -
                  (reservedByPayment.get(selectedPayment.id) ?? 0),
                0,
              )}
              shiftOpen={Boolean(shiftId)}
              onSubmit={request}
            />
          ) : (
            <div className="refund-empty refund-empty--panel">
              <Icon name="card" size={28} />
              <strong>Select a confirmed tender</strong>
            </div>
          )}
          <div className="non-fiscal-warning">NOT A FISCAL CREDIT NOTE</div>
        </aside>
      </div>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RefundRequest({
  payment,
  refundableMinor,
  canRequest,
  shiftOpen,
  busy,
  onSubmit,
}: {
  payment: PaymentResponse;
  refundableMinor: number;
  canRequest: boolean;
  shiftOpen: boolean;
  busy: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <span className="eyebrow">{orderNumber(payment)}</span>
      <h2>Request refund</h2>
      <dl className="refund-panel-facts">
        <div>
          <dt>Original tender</dt>
          <dd>{tenderLabels[payment.method]}</dd>
        </div>
        <div>
          <dt>Refundable</dt>
          <dd>{formatMoney(money(refundableMinor))}</dd>
        </div>
      </dl>
      {!canRequest ? (
        <p className="manual-warning">This account cannot request refunds.</p>
      ) : !shiftOpen ? (
        <p className="manual-warning">
          Open a device shift before requesting a refund.
        </p>
      ) : (
        <>
          <fieldset className="refund-kind-fieldset">
            <legend>Refund kind</legend>
            {(Object.keys(kindLabels) as RefundKind[]).map((kind) => (
              <label key={kind}>
                <input
                  defaultChecked={kind === "REFUND"}
                  name="kind"
                  type="radio"
                  value={kind}
                />
                {kindLabels[kind]}
              </label>
            ))}
          </fieldset>
          <label>
            Amount (GHS)
            <input
              defaultValue={(refundableMinor / 100).toFixed(2)}
              max={(refundableMinor / 100).toFixed(2)}
              min="0.01"
              name="amount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label>
            Evidence note
            <textarea
              maxLength={500}
              name="evidenceNote"
              placeholder="Operational evidence only; no customer or account data"
              required
            />
          </label>
          <label>
            Reason required
            <textarea maxLength={500} name="reason" required />
          </label>
          <p className="manual-warning">
            Submission reserves the amount. A different authorized user must
            approve or reject it.
          </p>
          <button
            className="button button--pay"
            disabled={busy || refundableMinor <= 0}
            type="submit"
          >
            {busy ? "Submitting…" : "Request refund"}
          </button>
        </>
      )}
    </form>
  );
}

function RefundReview({
  refund,
  currentUserId,
  canApprove,
  canResolve,
  busy,
  onApprove,
  onResolve,
}: {
  refund: RefundResponse;
  currentUserId: string;
  canApprove: boolean;
  canResolve: boolean;
  busy: boolean;
  onApprove(event: FormEvent<HTMLFormElement>): void;
  onResolve(event: FormEvent<HTMLFormElement>): void;
}) {
  const separatedFromApproval = refund.requestedById !== currentUserId;
  const separatedFromResolution =
    refund.requestedById !== currentUserId &&
    refund.approval?.approverId !== currentUserId;
  return (
    <div>
      <span className="eyebrow">Refund review</span>
      <h2>{refund.order.orderNumber}</h2>
      <dl className="refund-panel-facts">
        <div>
          <dt>Original tender</dt>
          <dd>{tenderLabels[refund.payment.method]}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatMoney(money(refund.amountMinor))}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{refund.requestedByDisplayName}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{refund.status.replaceAll("_", " ")}</dd>
        </div>
      </dl>
      <div className="refund-audit-note">
        <strong>Request evidence</strong>
        <span>{refund.evidenceNote}</span>
        <small>{refund.reason}</small>
      </div>
      {refund.status === "AWAITING_APPROVAL" ? (
        !canApprove ? (
          <p className="manual-warning">
            This account cannot approve refund requests.
          </p>
        ) : !separatedFromApproval ? (
          <p className="manual-warning">
            You cannot approve your own request. Sign in as a different
            authorized user.
          </p>
        ) : (
          <form className="refund-review-form" onSubmit={onApprove}>
            <h3>Independent approval</h3>
            <label>
              Evidence note
              <textarea name="approvalEvidence" required />
            </label>
            <label>
              Reason required
              <textarea name="approvalReason" required />
            </label>
            <div className="verification-actions">
              <button
                className="button button--outline"
                disabled={busy}
                name="decision"
                value="REJECT"
              >
                Reject
              </button>
              <button
                className="button button--complete"
                disabled={busy}
                name="decision"
                value="APPROVE"
              >
                Approve
              </button>
            </div>
          </form>
        )
      ) : null}
      {refund.status === "PENDING_PROVIDER" ? (
        !canResolve ? (
          <p className="manual-warning">
            This account cannot record provider resolution.
          </p>
        ) : !separatedFromResolution ? (
          <p className="manual-warning">
            Provider resolution requires a third authorized user who neither
            requested nor approved this refund.
          </p>
        ) : (
          <form className="refund-review-form" onSubmit={onResolve}>
            <h3>Provider resolution</h3>
            <label>
              Provider reference
              <input
                autoComplete="off"
                name="providerReference"
                placeholder="Fictional/test reference in demo environments"
                required
              />
            </label>
            <label>
              Evidence note
              <textarea name="resolutionEvidence" required />
            </label>
            <label>
              Reason required
              <textarea name="resolutionReason" required />
            </label>
            <div className="verification-actions">
              <button
                className="button button--outline"
                disabled={busy}
                name="outcome"
                value="FAILED"
              >
                Failed
              </button>
              <button
                className="button button--complete"
                disabled={busy}
                name="outcome"
                value="CONFIRMED"
              >
                Confirmed
              </button>
            </div>
          </form>
        )
      ) : null}
      {refund.approval ? (
        <div className="refund-audit-note">
          <strong>
            {refund.approval.decision} · {refund.approval.approverDisplayName}
          </strong>
          <span>{refund.approval.evidenceNote}</span>
          <small>{refund.approval.reason}</small>
        </div>
      ) : null}
      {refund.providerReference ? (
        <div className="refund-audit-note">
          <strong>Provider resolution</strong>
          <span>{refund.providerReference}</span>
          <small>{refund.resolvedByDisplayName ?? "Authorized resolver"}</small>
        </div>
      ) : null}
    </div>
  );
}
