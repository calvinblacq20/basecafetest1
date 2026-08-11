export type ReceiptSnapshot = Readonly<{
  label: "NOT A FISCAL RECEIPT";
  receiptNumber: string;
  orderNumber: string;
  branchName: string;
  businessDate: string;
  completedAt: string;
  cashierName: string;
  channel: string;
  currency: "GHS" | string;
  lines: readonly {
    name: string;
    quantity: number;
    grossMinor: number;
    modifiers: readonly string[];
  }[];
  taxComponents: readonly { label: string; amountMinor: number }[];
  tenders: readonly {
    method: string;
    amountMinor: number;
    changeMinor: number;
  }[];
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  footer: string;
}>;

export function money(minor: number, currency = "GHS") {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${currency} ${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function renderReceiptHtml(snapshot: ReceiptSnapshot, reprint = false) {
  const rows = snapshot.lines
    .map(
      (line) =>
        `<tr><td>${line.quantity} x ${escape(line.name)}${line.modifiers
          .map((modifier) => `<small>+ ${escape(modifier)}</small>`)
          .join(
            "",
          )}</td><td>${money(line.grossMinor, snapshot.currency)}</td></tr>`,
    )
    .join("");
  const taxes = snapshot.taxComponents
    .map(
      (tax) =>
        `<tr><th>${escape(tax.label)}</th><td>${money(tax.amountMinor, snapshot.currency)}</td></tr>`,
    )
    .join("");
  const tenders = snapshot.tenders
    .map(
      (tender) =>
        `<tr><th>${escape(tender.method)}</th><td>${money(tender.amountMinor, snapshot.currency)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(snapshot.receiptNumber)}</title><style>@page{size:80mm auto;margin:4mm}body{font:12px ui-monospace,monospace;width:72mm;margin:auto;color:#111}h1,p{text-align:center}h1{font-size:17px}.warning{border:2px solid #111;padding:6px;font-weight:700}table{width:100%;border-collapse:collapse}td,th{padding:4px 0;text-align:left;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}small{display:block;margin-left:14px}.total{border-top:1px dashed #111;font-size:15px;font-weight:700}.meta{white-space:pre-line}</style></head><body><p class="warning">${reprint ? "REPRINT - " : ""}${snapshot.label}</p><h1>${escape(snapshot.branchName)}</h1><p class="meta">Receipt ${escape(snapshot.receiptNumber)}\nOrder ${escape(snapshot.orderNumber)}\n${escape(snapshot.completedAt)}\nCashier ${escape(snapshot.cashierName)} - ${escape(snapshot.channel)}</p><table>${rows}<tr><th>Net</th><td>${money(snapshot.netMinor, snapshot.currency)}</td></tr>${taxes}<tr class="total"><th>Total</th><td>${money(snapshot.totalMinor, snapshot.currency)}</td></tr>${tenders}</table><p>${escape(snapshot.footer)}</p></body></html>`;
}
