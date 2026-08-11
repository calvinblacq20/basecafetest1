export type RefundSnapshot = Readonly<{
  label: "NOT A FISCAL CREDIT NOTE";
  refundId: string;
  receiptNumber: string | null;
  orderNumber: string;
  paymentMethod: string;
  kind: string;
  amountMinor: number;
  currency: string;
  confirmedAt: string;
  reason: string;
}>;

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function renderRefundHtml(snapshot: RefundSnapshot) {
  const amount = `${snapshot.currency} ${Math.floor(snapshot.amountMinor / 100)}.${String(snapshot.amountMinor % 100).padStart(2, "0")}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:4mm}body{font:12px ui-monospace,monospace;width:72mm;margin:auto;text-align:center;color:#111}.warning{border:2px solid #111;padding:6px;font-weight:700}.amount{font-size:20px;font-weight:700}</style></head><body><p class="warning">${snapshot.label}</p><p>Refund ${escape(snapshot.refundId)}<br>Original receipt ${escape(snapshot.receiptNumber ?? "not generated")}<br>Order ${escape(snapshot.orderNumber)}<br>${escape(snapshot.kind)} - ${escape(snapshot.paymentMethod)}</p><p class="amount">-${amount}</p><p>${escape(snapshot.confirmedAt)}<br>${escape(snapshot.reason)}</p></body></html>`;
}
