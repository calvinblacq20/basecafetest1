"use client";

import type {
  OrderChannel,
  PaymentListResponse,
  PaymentMethod,
  PaymentResponse,
  ReceiptResponse,
  SyncBootstrapResponse,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { FormEvent, useEffect, useRef, useState } from "react";

import type {
  CreateWorkingOrderInput,
  LocalLineModifier,
  WorkingOrder,
} from "./offline/cashier-runtime";
import type { LocalSyncSummary } from "./offline/sync-store";

type CatalogItem = SyncBootstrapResponse["catalog"][number];

export function CreateOrderDialog({
  channel,
  tables,
  onClose,
  onConfirm,
}: {
  channel: OrderChannel;
  tables: SyncBootstrapResponse["tables"];
  onClose: () => void;
  onConfirm: (input: CreateWorkingOrderInput) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = {
    DINE_IN: "Dine-in order",
    TAKEAWAY: "Takeaway order",
    PHONE_DELIVERY: "Phone-delivery order",
    BAR_TAB: "Bar tab",
  }[channel];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const tableId = text("tableId");
    const guestCount = Number(text("guestCount"));
    const input: CreateWorkingOrderInput = {
      channel,
      tableId: tableId || undefined,
      guestCount:
        channel === "DINE_IN" &&
        Number.isSafeInteger(guestCount) &&
        guestCount > 0
          ? guestCount
          : undefined,
      pickupReference: text("pickupReference") || undefined,
      customerReference: text("customerReference") || undefined,
      tabName: text("tabName") || undefined,
      note: text("note") || undefined,
    };
    if (channel === "PHONE_DELIVERY" && !input.customerReference)
      return setError("Phone delivery requires a customer reference.");
    if (channel === "BAR_TAB" && !input.tabName)
      return setError("Enter a name for the bar tab.");
    setBusy(true);
    setError(null);
    try {
      await onConfirm(input);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replaceAll("_", " ")
          : "The order could not be created.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="payment-modal order-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-order-title"
      >
        <div className="payment-modal__header">
          <div>
            <span>Cashier-entered service details</span>
            <h2 id="create-order-title">{label}</h2>
          </div>
          <button
            aria-label="Close order details"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <form className="cash-form" onSubmit={submit}>
          {channel === "DINE_IN" || channel === "BAR_TAB" ? (
            <label>
              Table (optional)
              <select name="tableId" defaultValue="">
                <option value="">No table</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.areaName} · {table.name}
                    {table.capacity ? ` · ${table.capacity} seats` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {channel === "DINE_IN" ? (
            <label>
              Guest count (optional)
              <input
                min="1"
                max="100"
                name="guestCount"
                step="1"
                type="number"
              />
            </label>
          ) : null}
          {channel === "TAKEAWAY" ? (
            <label>
              Pickup reference (optional)
              <input
                maxLength={120}
                name="pickupReference"
                placeholder="Name or collection reference"
              />
            </label>
          ) : null}
          {channel === "PHONE_DELIVERY" ? (
            <label>
              Customer reference
              <input
                maxLength={120}
                name="customerReference"
                placeholder="Operational name or reference"
                required
              />
            </label>
          ) : null}
          {channel === "BAR_TAB" ? (
            <label>
              Tab name
              <input maxLength={120} name="tabName" required />
            </label>
          ) : null}
          <label>
            Order note (optional)
            <textarea maxLength={1000} name="note" rows={3} />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <p>
            No customer phone or delivery directions appear in the POS bootstrap
            or KDS queue.
          </p>
          <div className="dialog-actions">
            <button
              className="button button--outline"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--pay"
              disabled={busy}
              type="submit"
            >
              {busy ? "Creating…" : "Create order"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ReceiptDialog({
  receipt,
  html,
  onClose,
  onReprint,
}: {
  receipt: ReceiptResponse;
  html: string;
  onClose: () => void;
  onReprint: () => Promise<string>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [rendered, setRendered] = useState(html);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="payment-modal receipt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
      >
        <div className="payment-modal__header">
          <div>
            <span>Commercial receipt · non-fiscal</span>
            <h2 id="receipt-title">{receipt.receiptNumber}</h2>
          </div>
          <button aria-label="Close receipt" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="receipt-warning" role="note">
          <strong>NOT A FISCAL RECEIPT</strong>
          <span>
            No GRA fiscal mark, QR code, signature or serial number has been
            generated.
          </span>
        </div>
        <iframe
          ref={frame}
          className="receipt-frame"
          srcDoc={rendered}
          title={`Receipt ${receipt.receiptNumber}`}
        />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="button button--outline"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          <button
            className="button button--pay"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const next = await onReprint();
                setRendered(next);
                window.setTimeout(
                  () => frame.current?.contentWindow?.print(),
                  50,
                );
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Reprint failed",
                );
              } finally {
                setBusy(false);
              }
            }}
            type="button"
          >
            {busy ? "Preparing…" : "Reprint and print"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ModifierDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: CatalogItem;
  onClose: () => void;
  onConfirm: (modifiers: LocalLineModifier[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const groupsValid = item.modifierGroups.every((group) => {
    const count = selected[group.id]?.length ?? 0;
    return count >= group.minimum && count <= group.maximum;
  });
  const policyConfirmed = item.modifierGroups.every((group) => {
    if (group.freeSelectionCount === 0) return true;
    const chosen = group.modifiers.filter((modifier) =>
      selected[group.id]?.includes(modifier.id),
    );
    return (
      new Set(chosen.map((modifier) => modifier.priceDeltaMinor)).size <= 1
    );
  });

  function confirm() {
    const values: LocalLineModifier[] = [];
    for (const group of item.modifierGroups) {
      const chosen = group.modifiers
        .filter((modifier) => selected[group.id]?.includes(modifier.id))
        .map((modifier) => ({
          ...modifier,
          lineModifierId: crypto.randomUUID(),
        }))
        .sort((left, right) =>
          left.lineModifierId.localeCompare(right.lineModifierId),
        );
      chosen.forEach((modifier, index) =>
        values.push({
          lineModifierId: modifier.lineModifierId,
          modifierId: modifier.id,
          name: modifier.name,
          priceDeltaMinor: modifier.priceDeltaMinor,
          chargedDeltaMinor:
            index < group.freeSelectionCount ? 0 : modifier.priceDeltaMinor,
        }),
      );
    }
    onConfirm(values);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="payment-modal modifier-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="payment-modal__header">
          <div>
            <span>Configure item</span>
            <h2>
              {item.variantName
                ? `${item.name} · ${item.variantName}`
                : item.name}
            </h2>
          </div>
          <button aria-label="Close modifiers" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modifier-groups">
          {item.modifierGroups.map((group) => (
            <fieldset key={group.id}>
              <legend>
                {group.name}
                <small>
                  {group.minimum}–{group.maximum} selections
                </small>
              </legend>
              {group.modifiers.map((modifier) => {
                const checked =
                  selected[group.id]?.includes(modifier.id) ?? false;
                const maximumReached =
                  !checked &&
                  (selected[group.id]?.length ?? 0) >= group.maximum;
                return (
                  <label key={modifier.id}>
                    <input
                      checked={checked}
                      disabled={maximumReached}
                      onChange={() =>
                        setSelected((current) => {
                          const values = current[group.id] ?? [];
                          return {
                            ...current,
                            [group.id]: checked
                              ? values.filter((id) => id !== modifier.id)
                              : [...values, modifier.id],
                          };
                        })
                      }
                      type="checkbox"
                    />
                    <span>{modifier.name}</span>
                    <strong>
                      +{formatMoney(money(modifier.priceDeltaMinor))}
                    </strong>
                  </label>
                );
              })}
            </fieldset>
          ))}
          {!policyConfirmed ? (
            <p className="form-error">
              Mixed-price free selections remain blocked until the owner policy
              is confirmed.
            </p>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button
            className="button button--outline"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--pay"
            disabled={!groupsValid || !policyConfirmed}
            onClick={confirm}
            type="button"
          >
            Add item
          </button>
        </div>
      </section>
    </div>
  );
}

const TENDER_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  MANUAL_MOMO: "Manual MoMo",
  EXTERNAL_CARD: "External terminal",
  BANK_TRANSFER: "Bank transfer",
};

export function SplitTenderDialog({
  order,
  currentUserId,
  canVerify,
  onClose,
  onLoad,
  onCash,
  onManual,
  onVerify,
}: {
  order: WorkingOrder;
  currentUserId: string;
  canVerify: boolean;
  onClose: () => void;
  onLoad: () => Promise<PaymentListResponse>;
  onCash: (amountMinor: number, tenderedMinor: number) => Promise<void>;
  onManual: (input: {
    method: Exclude<PaymentMethod, "CASH">;
    amountMinor: number;
    externalReference: string;
    evidenceNote?: string;
  }) => Promise<void>;
  onVerify: (
    payment: PaymentResponse,
    decision: "CONFIRM" | "FAIL",
    evidenceNote: string,
    reason: string,
  ) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [payments, setPayments] = useState<PaymentListResponse>([]);
  const [selected, setSelected] = useState<PaymentResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const confirmed = Math.max(
    order.confirmedPaymentMinor,
    payments
      .filter((payment) => payment.status === "CONFIRMED")
      .reduce((sum, payment) => sum + payment.amountMinor, 0),
  );
  const awaiting = payments
    .filter((payment) => payment.status === "REQUIRES_VERIFICATION")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const remaining = Math.max(order.totals.grossTotalMinor - confirmed, 0);
  const available = Math.max(remaining - awaiting, 0);

  async function reload() {
    if (!navigator.onLine) return setOffline(true);
    try {
      setPayments(await onLoad());
      setOffline(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Tender history could not be loaded.",
      );
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
    // The order ID identifies this dialog lifetime.
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amountMinor = Math.round(Number(data.get("amount")) * 100);
    const tenderedMinor = Math.round(Number(data.get("tendered")) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return setError("Enter a valid tender amount.");
    if (amountMinor > available)
      return setError("This tender exceeds the unreserved remaining balance.");
    if (method === "CASH" && tenderedMinor < amountMinor)
      return setError("Cash received must cover this tender amount.");
    const externalReference = String(
      data.get("externalReference") ?? "",
    ).trim();
    if (method !== "CASH" && !externalReference)
      return setError("Electronic tenders require an external reference.");
    setBusy(true);
    setError(null);
    try {
      if (method === "CASH") await onCash(amountMinor, tenderedMinor);
      else
        await onManual({
          method,
          amountMinor,
          externalReference,
          evidenceNote:
            String(data.get("evidenceNote") ?? "").trim() || undefined,
        });
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The tender could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const evidence = String(data.get("verificationEvidence") ?? "").trim();
    const reason = String(data.get("verificationReason") ?? "").trim();
    const decision = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value as "CONFIRM" | "FAIL";
    if (!evidence || !reason)
      return setError("Evidence and a reason are required.");
    setBusy(true);
    setError(null);
    try {
      await onVerify(selected, decision, evidence, reason);
      setSelected(null);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="payment-title"
        aria-modal="true"
        className="payment-modal payment-modal--split"
        role="dialog"
      >
        <div className="payment-modal__header">
          <div>
            <span>
              {order.orderNumber} · {order.clientReference}
            </span>
            <h2 id="payment-title">Take payment</h2>
          </div>
          <button aria-label="Close payment" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="payment-totals" aria-label="Payment totals">
          <div>
            <span>Order total</span>
            <strong>{formatMoney(money(order.totals.grossTotalMinor))}</strong>
          </div>
          <div>
            <span>Confirmed</span>
            <strong>{formatMoney(money(confirmed))}</strong>
          </div>
          <div>
            <span>Awaiting verification</span>
            <strong>{formatMoney(money(awaiting))}</strong>
          </div>
          <div>
            <span>Remaining</span>
            <strong>{formatMoney(money(remaining))}</strong>
          </div>
        </div>
        <div className="split-tender-layout">
          <form className="tender-form" onSubmit={submit}>
            <h3>Add tender</h3>
            <div className="tender-methods" aria-label="Tender method">
              {(Object.keys(TENDER_LABELS) as PaymentMethod[]).map((value) => (
                <button
                  aria-pressed={method === value}
                  className={method === value ? "is-active" : ""}
                  disabled={offline && value !== "CASH"}
                  key={value}
                  onClick={() => setMethod(value)}
                  type="button"
                >
                  {TENDER_LABELS[value]}
                </button>
              ))}
            </div>
            <label>
              Amount (GHS)
              <input
                defaultValue={(available / 100).toFixed(2)}
                key={`${method}:${available}`}
                max={(available / 100).toFixed(2)}
                min="0.01"
                name="amount"
                required
                step="0.01"
                type="number"
              />
            </label>
            {method === "CASH" ? (
              <label>
                Cash received (GHS)
                <input
                  defaultValue={(available / 100).toFixed(2)}
                  key={`cash:${available}`}
                  min="0.01"
                  name="tendered"
                  required
                  step="0.01"
                  type="number"
                />
              </label>
            ) : (
              <>
                <label>
                  External reference
                  <input
                    autoComplete="off"
                    name="externalReference"
                    placeholder="Required operational reference"
                    required
                  />
                </label>
                <label>
                  Recording note (optional)
                  <textarea
                    name="evidenceNote"
                    placeholder="No customer or account details"
                  />
                </label>
                <p className="manual-warning">
                  Recorded manually — not provider confirmed. A different
                  authorized user must confirm or fail it.
                </p>
              </>
            )}
            {offline ? (
              <p className="manual-warning">
                Offline: only cash may be queued. Tender history refreshes after
                reconnection.
              </p>
            ) : null}
            <button
              className="button button--pay"
              disabled={busy || available <= 0}
              type="submit"
            >
              {busy ? "Recording…" : "Add tender"}
            </button>
          </form>
          <section className="tender-history" aria-label="Tender history">
            <div className="tender-history__heading">
              <h3>Tender history</h3>
              <button
                disabled={busy || offline}
                onClick={() => void reload()}
                type="button"
              >
                Refresh
              </button>
            </div>
            {payments.length ? (
              payments.map((payment) => (
                <article
                  className="tender-entry"
                  data-status={payment.status}
                  key={payment.id}
                >
                  <div>
                    <strong>{TENDER_LABELS[payment.method]}</strong>
                    <span>
                      {payment.createdByDisplayName} ·{" "}
                      {new Date(payment.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {payment.externalReference ? (
                      <span>Ref: {payment.externalReference}</span>
                    ) : null}
                  </div>
                  <div>
                    <strong>{formatMoney(money(payment.amountMinor))}</strong>
                    <span>
                      {payment.status === "REQUIRES_VERIFICATION"
                        ? "Awaiting independent verification"
                        : payment.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  {payment.status === "REQUIRES_VERIFICATION" ? (
                    <button onClick={() => setSelected(payment)} type="button">
                      Review
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-tenders">
                <strong>No recorded tenders</strong>
                <span>
                  Split this order across one or more exact allocations.
                </span>
              </div>
            )}
          </section>
        </div>
        {error ? (
          <p className="payment-error" role="alert">
            {error}
          </p>
        ) : null}
        {selected ? (
          <form className="verification-panel" onSubmit={verify}>
            <div className="tender-history__heading">
              <div>
                <span>Independent verification</span>
                <h3>
                  {TENDER_LABELS[selected.method]} ·{" "}
                  {formatMoney(money(selected.amountMinor))}
                </h3>
              </div>
              <button onClick={() => setSelected(null)} type="button">
                ×
              </button>
            </div>
            {selected.createdById === currentUserId ? (
              <p className="manual-warning">
                You cannot verify a tender you recorded. Sign in as a different
                authorized user.
              </p>
            ) : !canVerify ? (
              <p className="manual-warning">
                This account does not have payment verification permission.
              </p>
            ) : (
              <>
                <label>
                  Evidence note
                  <textarea
                    name="verificationEvidence"
                    placeholder="Describe the evidence reviewed"
                    required
                  />
                </label>
                <label>
                  Reason
                  <input
                    name="verificationReason"
                    placeholder="Required audit reason"
                    required
                  />
                </label>
                <div className="verification-actions">
                  <button
                    className="button button--outline"
                    disabled={busy}
                    name="decision"
                    value="FAIL"
                  >
                    Fail tender
                  </button>
                  <button
                    className="button button--complete"
                    disabled={busy}
                    name="decision"
                    value="CONFIRM"
                  >
                    Confirm tender
                  </button>
                </div>
              </>
            )}
          </form>
        ) : null}
      </section>
    </div>
  );
}

export function TenderVerificationDialog({
  order,
  currentUserId,
  canVerify,
  onClose,
  onLoad,
  onVerify,
}: {
  order: { id: string; orderNumber: string; grossTotalMinor: number };
  currentUserId: string;
  canVerify: boolean;
  onClose: () => void;
  onLoad: () => Promise<PaymentListResponse>;
  onVerify: (
    payment: PaymentResponse,
    decision: "CONFIRM" | "FAIL",
    evidenceNote: string,
    reason: string,
  ) => Promise<void>;
}) {
  const [payments, setPayments] = useState<PaymentListResponse>([]);
  const [selected, setSelected] = useState<PaymentResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = payments
    .filter((payment) => payment.status === "CONFIRMED")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const awaiting = payments
    .filter((payment) => payment.status === "REQUIRES_VERIFICATION")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);

  async function reload() {
    try {
      setPayments(await onLoad());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Tender history could not be loaded.",
      );
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const evidence = String(data.get("verificationEvidence") ?? "").trim();
    const reason = String(data.get("verificationReason") ?? "").trim();
    const decision = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value as "CONFIRM" | "FAIL";
    if (!evidence || !reason)
      return setError("Evidence and a reason are required.");
    setBusy(true);
    setError(null);
    try {
      await onVerify(selected, decision, evidence, reason);
      setSelected(null);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="verification-history-title"
        aria-modal="true"
        className="payment-modal payment-modal--verification"
        role="dialog"
      >
        <div className="payment-modal__header">
          <div>
            <span>{order.orderNumber}</span>
            <h2 id="verification-history-title">Payment verification</h2>
          </div>
          <button
            aria-label="Close payment verification"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="payment-totals payment-totals--three">
          <div>
            <span>Order total</span>
            <strong>{formatMoney(money(order.grossTotalMinor))}</strong>
          </div>
          <div>
            <span>Confirmed</span>
            <strong>{formatMoney(money(confirmed))}</strong>
          </div>
          <div>
            <span>Awaiting verification</span>
            <strong>{formatMoney(money(awaiting))}</strong>
          </div>
        </div>
        <section
          className="tender-history tender-history--review"
          aria-label="Tender history"
        >
          <div className="tender-history__heading">
            <h3>Tender history</h3>
            <button disabled={busy} onClick={() => void reload()} type="button">
              Refresh
            </button>
          </div>
          {payments.length ? (
            payments.map((payment) => (
              <article
                className="tender-entry"
                data-status={payment.status}
                key={payment.id}
              >
                <div>
                  <strong>{TENDER_LABELS[payment.method]}</strong>
                  <span>{payment.createdByDisplayName}</span>
                  {payment.externalReference ? (
                    <span>Ref: {payment.externalReference}</span>
                  ) : null}
                </div>
                <div>
                  <strong>{formatMoney(money(payment.amountMinor))}</strong>
                  <span>
                    {payment.status === "REQUIRES_VERIFICATION"
                      ? "Awaiting independent verification"
                      : payment.status.replaceAll("_", " ")}
                  </span>
                </div>
                {payment.status === "REQUIRES_VERIFICATION" ? (
                  <button onClick={() => setSelected(payment)} type="button">
                    Review
                  </button>
                ) : null}
              </article>
            ))
          ) : (
            <div className="empty-tenders">
              <strong>No recorded tenders</strong>
            </div>
          )}
        </section>
        {error ? (
          <p className="payment-error" role="alert">
            {error}
          </p>
        ) : null}
        {selected ? (
          <form className="verification-panel" onSubmit={submit}>
            <div className="tender-history__heading">
              <div>
                <span>Independent verification</span>
                <h3>
                  {TENDER_LABELS[selected.method]} ·{" "}
                  {formatMoney(money(selected.amountMinor))}
                </h3>
              </div>
              <button onClick={() => setSelected(null)} type="button">
                ×
              </button>
            </div>
            {selected.createdById === currentUserId ? (
              <p className="manual-warning">
                You cannot verify a tender you recorded. Sign in as a different
                authorized user.
              </p>
            ) : !canVerify ? (
              <p className="manual-warning">
                This account does not have payment verification permission.
              </p>
            ) : (
              <>
                <label>
                  Evidence note
                  <textarea
                    name="verificationEvidence"
                    placeholder="Describe the evidence reviewed"
                    required
                  />
                </label>
                <label>
                  Reason
                  <input
                    name="verificationReason"
                    placeholder="Required audit reason"
                    required
                  />
                </label>
                <div className="verification-actions">
                  <button
                    className="button button--outline"
                    disabled={busy}
                    name="decision"
                    value="FAIL"
                  >
                    Fail tender
                  </button>
                  <button
                    className="button button--complete"
                    disabled={busy}
                    name="decision"
                    value="CONFIRM"
                  >
                    Confirm tender
                  </button>
                </div>
              </>
            )}
          </form>
        ) : null}
      </section>
    </div>
  );
}

export function ShiftDialog({
  shift,
  summary,
  onClose,
  onOpenShift,
  onCloseShift,
}: {
  shift: SyncBootstrapResponse["shift"];
  summary: LocalSyncSummary;
  onClose: () => void;
  onOpenShift: (amountMinor: number) => Promise<void>;
  onCloseShift: (amountMinor: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unresolved =
    summary.pending + summary.sending + summary.conflicts + summary.failed;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Math.round(
      Number(new FormData(event.currentTarget).get("cash")) * 100,
    );
    if (!Number.isSafeInteger(amount) || amount < 0)
      return setError("Enter a valid cash count.");
    setBusy(true);
    setError(null);
    try {
      if (shift) await onCloseShift(amount);
      else await onOpenShift(amount);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Shift action failed",
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="payment-modal shift-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-title"
      >
        <div className="payment-modal__header">
          <div>
            <span>Device-bound cash responsibility</span>
            <h2 id="shift-title">
              {shift ? "Close current shift" : "Open a shift"}
            </h2>
          </div>
          <button
            aria-label="Close shift dialog"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="shift-sync-guard" data-clear={unresolved === 0}>
          <strong>
            {unresolved === 0
              ? "Local queue clear"
              : `${unresolved} local command(s) unresolved`}
          </strong>
          <span>
            {unresolved === 0
              ? "The device has no unsynchronized work."
              : "Shift close is blocked until queued, failed, and conflicting commands are resolved."}
          </span>
        </div>
        <form className="cash-form" onSubmit={submit}>
          <label>
            {shift ? "Counted cash (GHS)" : "Opening float (GHS)"}
            <input min="0" name="cash" required step="0.01" type="number" />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="button button--outline"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--pay"
              disabled={busy || Boolean(shift && unresolved > 0)}
              type="submit"
            >
              {busy ? "Working…" : shift ? "Close shift" : "Open shift"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function OfflineAccessDialog({
  minimumPinLength,
  expiresAt,
  enrolled,
  onClose,
  onEnroll,
}: {
  minimumPinLength: number;
  expiresAt: string | null;
  enrolled: boolean;
  onClose: () => void;
  onEnroll: (pin: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pin = String(data.get("pin") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (pin !== confirmation) return setError("The PIN entries do not match.");
    setBusy(true);
    setError(null);
    try {
      await onEnroll(pin);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Offline enrollment failed",
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="payment-modal offline-access-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-access-title"
      >
        <div className="payment-modal__header">
          <div>
            <span>Encrypted local access</span>
            <h2 id="offline-access-title">Offline restart PIN</h2>
          </div>
          <button
            aria-label="Close offline access"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="offline-policy-summary">
          <strong>{enrolled ? "PIN enrolled" : "PIN not enrolled"}</strong>
          <span>
            Lease expiry:{" "}
            {expiresAt ? new Date(expiresAt).toLocaleString() : "Unavailable"}
          </span>
          <small>
            This PIN decrypts only the cached device working set. It cannot call
            server APIs, approve exceptions, or restore an online session.
          </small>
        </div>
        <form className="cash-form" onSubmit={submit}>
          <label>
            New numeric PIN
            <input
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={12}
              minLength={minimumPinLength}
              name="pin"
              pattern={`[0-9]{${minimumPinLength},12}`}
              required
              type="password"
            />
          </label>
          <label>
            Confirm PIN
            <input
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={12}
              minLength={minimumPinLength}
              name="confirmation"
              pattern={`[0-9]{${minimumPinLength},12}`}
              required
              type="password"
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="button button--outline"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--pay"
              disabled={busy}
              type="submit"
            >
              {busy ? "Encrypting…" : enrolled ? "Replace PIN" : "Enroll PIN"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
