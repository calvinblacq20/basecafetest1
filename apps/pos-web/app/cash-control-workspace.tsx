"use client";

import type {
  CashMovementResponse,
  CashMovementType,
  SyncBootstrapResponse,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { Icon } from "@base-cafe/ui";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";
import {
  approveCashMovement,
  listCashMovements,
  requestCashMovement,
} from "./cash-control-client";

type Shift = NonNullable<SyncBootstrapResponse["shift"]>;

const typeLabels: Record<CashMovementType, string> = {
  PAID_IN: "Paid in",
  PAID_OUT: "Paid out",
  BANK_DROP: "Bank drop",
  CORRECTION: "Correction",
};

function message(error: unknown) {
  const value = error instanceof Error ? error.message : "CASH_ACTION_FAILED";
  const labels: Record<string, string> = {
    CASH_MOVEMENT_SELF_APPROVAL_FORBIDDEN:
      "You cannot approve your own request. Sign in as a different authorized user.",
    CASH_MOVEMENT_SHIFT_NOT_OPEN:
      "Open a device shift as the current cashier before recording a movement.",
    CASH_CORRECTION_SOURCE_INVALID:
      "A correction must reference a posted movement in this branch.",
    STALE_REVISION: "The record changed. Refresh and try again.",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function signedAmount(movement: CashMovementResponse) {
  return movement.direction === "IN"
    ? movement.amountMinor
    : -movement.amountMinor;
}

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));
}

export function CashControlWorkspace({
  runtime,
  shift,
}: {
  runtime: CashierRuntime;
  shift: Shift | null;
}) {
  const [movements, setMovements] = useState<CashMovementResponse[]>([]);
  const [cashSalesMinor, setCashSalesMinor] = useState(0);
  const [cashRefundsMinor, setCashRefundsMinor] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<CashMovementType>("PAID_IN");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = runtime.session.user.permissions;
  const currentUserId = runtime.session.scope.userId;

  const reload = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [movementList, payments, refunds] = await Promise.all([
        listCashMovements(runtime.session),
        runtime.listOrderPayments(),
        runtime.listRefunds(),
      ]);
      setMovements(movementList);
      setSelectedId((current) => current ?? movementList[0]?.id ?? null);
      if (shift) {
        setCashSalesMinor(
          payments
            .filter(
              (payment) =>
                payment.shiftId === shift.id &&
                payment.method === "CASH" &&
                payment.status === "CONFIRMED",
            )
            .reduce((sum, payment) => sum + payment.amountMinor, 0),
        );
        setCashRefundsMinor(
          refunds
            .filter(
              (refund) =>
                refund.shiftId === shift.id &&
                refund.payment.method === "CASH" &&
                refund.status === "CONFIRMED",
            )
            .reduce((sum, refund) => sum + refund.amountMinor, 0),
        );
      } else {
        setCashSalesMinor(0);
        setCashRefundsMinor(0);
      }
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setLoading(false);
    }
  }, [runtime, shift]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const selected = movements.find((movement) => movement.id === selectedId);
  const postedForShift = movements.filter(
    (movement) =>
      movement.status === "POSTED" && (!shift || movement.shiftId === shift.id),
  );
  const postedMovementMinor = postedForShift.reduce(
    (sum, movement) => sum + signedAmount(movement),
    0,
  );
  const expectedCashMinor = shift
    ? shift.openingFloatMinor +
      cashSalesMinor -
      cashRefundsMinor +
      postedMovementMinor
    : null;
  const postedSources = useMemo(
    () => movements.filter((movement) => movement.status === "POSTED"),
    [movements],
  );

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shift) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountMinor = Math.round(Number(data.get("amount")) * 100);
    const direction = String(data.get("direction")) as "IN" | "OUT";
    const correctsMovementId = String(
      data.get("correctsMovementId") ?? "",
    ).trim();
    const reference = String(data.get("reference") ?? "").trim();
    const evidenceNote = String(data.get("evidenceNote") ?? "").trim();
    const reason = String(data.get("reason") ?? "").trim();
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return setNotice("Enter a valid positive amount.");
    if (!evidenceNote || !reason)
      return setNotice("Evidence and an audit reason are required.");
    if (movementType === "CORRECTION" && !correctsMovementId)
      return setNotice("Select the posted movement being corrected.");
    setBusy(true);
    try {
      const created = await requestCashMovement(runtime.session, shift, {
        type: movementType,
        direction,
        amountMinor,
        ...(correctsMovementId ? { correctsMovementId } : {}),
        ...(reference ? { reference } : {}),
        evidenceNote,
        reason,
      });
      setSelectedId(created.id);
      form.reset();
      setMovementType("PAID_IN");
      await reload();
      setNotice("Cash movement awaits independent approval.");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const evidenceNote = String(data.get("approvalEvidence") ?? "").trim();
    const reason = String(data.get("approvalReason") ?? "").trim();
    const decision = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value as "APPROVE" | "REJECT";
    if (!evidenceNote || !reason)
      return setNotice("Evidence and an audit reason are required.");
    setBusy(true);
    try {
      await approveCashMovement(
        runtime.session,
        selected,
        decision,
        evidenceNote,
        reason,
      );
      await reload();
      setNotice(
        decision === "APPROVE"
          ? "Movement posted to expected cash."
          : "Movement rejected with retained history.",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cash-workspace" aria-label="Cash control">
      <header className="cash-workspace__header">
        <div>
          <h1>Cash control</h1>
          <p>
            Online-only · a different authorized user must approve · posted
            records cannot be edited or deleted
          </p>
        </div>
        <button disabled={loading} onClick={() => void reload()} type="button">
          <Icon name="recall" size={19} /> Refresh
        </button>
      </header>

      <div className="cash-metrics" aria-label="Current shift cash summary">
        {[
          ["Opening float", shift ? shift.openingFloatMinor : null],
          ["Cash sales", shift ? cashSalesMinor : null],
          ["Cash refunds", shift ? cashRefundsMinor : null],
          ["Posted movements", shift ? postedMovementMinor : null],
          ["Expected cash", expectedCashMinor],
        ].map(([label, value]) => (
          <div key={label as string}>
            <span>{label}</span>
            <strong>
              {typeof value === "number"
                ? formatMoney(money(value))
                : "Not available"}
            </strong>
          </div>
        ))}
      </div>

      <div className="cash-layout">
        <section className="cash-ledger">
          <div className="cash-section-heading">
            <div>
              <span>Append-only ledger</span>
              <h2>Movement history</h2>
            </div>
            <small>
              {movements.filter((item) => item.status === "AWAITING_APPROVAL")
                .length || "No"}{" "}
              pending
            </small>
          </div>
          <div className="cash-table" role="table">
            <div className="cash-table__head" role="row">
              <span>Date &amp; time</span>
              <span>Movement</span>
              <span>Direction</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Recorded by</span>
            </div>
            {movements.map((movement) => (
              <button
                aria-selected={selectedId === movement.id}
                className={selectedId === movement.id ? "is-selected" : ""}
                key={movement.id}
                onClick={() => setSelectedId(movement.id)}
                role="row"
                type="button"
              >
                <span>{displayTime(movement.createdAt)}</span>
                <span>
                  <strong>{typeLabels[movement.type]}</strong>
                  <small>{movement.reference ?? "No reference"}</small>
                </span>
                <span>
                  {movement.direction === "IN" ? "Inward" : "Outward"}
                </span>
                <strong>{formatMoney(money(movement.amountMinor))}</strong>
                <span className="cash-status" data-status={movement.status}>
                  {movement.status === "AWAITING_APPROVAL"
                    ? "Awaiting independent approval"
                    : movement.status.toLocaleLowerCase()}
                </span>
                <span>{movement.requestedByDisplayName}</span>
              </button>
            ))}
            {!loading && movements.length === 0 ? (
              <div className="cash-empty">
                <strong>No cash movement history</strong>
                <span>New requests will remain here for audit review.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="cash-action-panel">
          {selected?.status === "AWAITING_APPROVAL" ? (
            <CashMovementReview
              busy={busy}
              canApprove={permissions.includes("cash-movements.approve")}
              currentUserId={currentUserId}
              movement={selected}
              onSubmit={approve}
            />
          ) : (
            <CashMovementRequest
              busy={busy}
              canRequest={permissions.includes("cash-movements.request")}
              movementType={movementType}
              onMovementType={setMovementType}
              onSubmit={request}
              postedSources={postedSources}
              selected={selected}
              shift={shift}
            />
          )}
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

function CashMovementRequest({
  shift,
  selected,
  postedSources,
  movementType,
  canRequest,
  busy,
  onMovementType,
  onSubmit,
}: {
  shift: Shift | null;
  selected: CashMovementResponse | undefined;
  postedSources: CashMovementResponse[];
  movementType: CashMovementType;
  canRequest: boolean;
  busy: boolean;
  onMovementType(value: CashMovementType): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  const fixedDirection =
    movementType === "PAID_IN"
      ? "IN"
      : movementType === "CORRECTION"
        ? null
        : "OUT";
  return (
    <form onSubmit={onSubmit}>
      <span className="eyebrow">Controlled movement</span>
      <h2>Record cash movement</h2>
      {selected && selected.status !== "AWAITING_APPROVAL" ? (
        <div className="cash-audit-note">
          <strong>
            {typeLabels[selected.type]} · {selected.status.toLocaleLowerCase()}
          </strong>
          <span>{selected.evidenceNote}</span>
          <small>{selected.reason}</small>
        </div>
      ) : null}
      {!canRequest ? (
        <p className="manual-warning">
          This account cannot request cash movements.
        </p>
      ) : !shift ? (
        <p className="manual-warning">
          This account can review branch history, but must be the current
          cashier on an open device shift to record a movement.
        </p>
      ) : (
        <>
          <label>
            Movement type
            <select
              name="type"
              onChange={(event) =>
                onMovementType(event.target.value as CashMovementType)
              }
              value={movementType}
            >
              {(Object.keys(typeLabels) as CashMovementType[]).map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select
              defaultValue={fixedDirection ?? "IN"}
              key={movementType}
              name="direction"
            >
              {fixedDirection ? (
                <option value={fixedDirection}>
                  {fixedDirection === "IN" ? "Inward" : "Outward"}
                </option>
              ) : (
                <>
                  <option value="IN">Inward</option>
                  <option value="OUT">Outward</option>
                </>
              )}
            </select>
          </label>
          <label>
            Amount (GHS)
            <input
              min="0.01"
              name="amount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label>
            Reference (optional)
            <input autoComplete="off" maxLength={160} name="reference" />
          </label>
          {movementType === "CORRECTION" ? (
            <label>
              Corrects movement
              <select name="correctsMovementId" required>
                <option value="">Select a posted movement</option>
                {postedSources.map((movement) => (
                  <option key={movement.id} value={movement.id}>
                    {typeLabels[movement.type]} ·{" "}
                    {formatMoney(money(movement.amountMinor))} ·{" "}
                    {displayTime(movement.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Evidence note
            <textarea
              maxLength={500}
              name="evidenceNote"
              placeholder="Operational evidence only; no account or customer data"
              required
            />
          </label>
          <label>
            Reason required
            <textarea maxLength={500} name="reason" required />
          </label>
          <p className="manual-warning">
            No reason catalog or approval threshold is configured. Every request
            requires a different authorized approver.
          </p>
          <button className="button button--pay" disabled={busy} type="submit">
            {busy ? "Submitting…" : "Record movement"}
          </button>
        </>
      )}
    </form>
  );
}

function CashMovementReview({
  movement,
  currentUserId,
  canApprove,
  busy,
  onSubmit,
}: {
  movement: CashMovementResponse;
  currentUserId: string;
  canApprove: boolean;
  busy: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <div>
      <span className="eyebrow">Independent review</span>
      <h2>{typeLabels[movement.type]}</h2>
      <dl className="cash-panel-facts">
        <div>
          <dt>Amount</dt>
          <dd>{formatMoney(money(movement.amountMinor))}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{movement.direction === "IN" ? "Inward" : "Outward"}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{movement.requestedByDisplayName}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{movement.reference ?? "None"}</dd>
        </div>
      </dl>
      <div className="cash-audit-note">
        <strong>Request evidence</strong>
        <span>{movement.evidenceNote}</span>
        <small>{movement.reason}</small>
      </div>
      {movement.correctsMovement ? (
        <div className="cash-audit-note">
          <strong>Correction source</strong>
          <span>
            {typeLabels[movement.correctsMovement.type]} ·{" "}
            {formatMoney(money(movement.correctsMovement.amountMinor))}
          </span>
          <small>
            {movement.correctsMovement.reference ??
              movement.correctsMovement.id}
          </small>
        </div>
      ) : null}
      {!canApprove ? (
        <p className="manual-warning">
          This account cannot approve cash movements.
        </p>
      ) : movement.requestedById === currentUserId ? (
        <p className="manual-warning">
          You cannot approve your own request. Sign in as a different authorized
          user.
        </p>
      ) : (
        <form className="cash-review-form" onSubmit={onSubmit}>
          <h3>Approval evidence</h3>
          <label>
            Evidence note
            <textarea maxLength={500} name="approvalEvidence" required />
          </label>
          <label>
            Reason required
            <textarea maxLength={500} name="approvalReason" required />
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
      )}
    </div>
  );
}
