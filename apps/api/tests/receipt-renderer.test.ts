import { describe, expect, it } from "vitest";
import {
  money,
  renderReceiptHtml,
  type ReceiptSnapshot,
} from "../src/receipts/receipt-renderer.js";

const snapshot: ReceiptSnapshot = {
  label: "NOT A FISCAL RECEIPT",
  receiptNumber: "R-20260807-0001",
  orderNumber: "20260807-0001",
  branchName: "Demo <Branch>",
  businessDate: "2026-08-07",
  completedAt: "2026-08-07T12:00:00.000Z",
  cashierName: "Ama",
  channel: "DINE_IN",
  currency: "GHS",
  lines: [
    { name: "Coffee", quantity: 2, grossMinor: 2500, modifiers: ["Milk"] },
  ],
  taxComponents: [{ label: "Configured tax", amountMinor: 200 }],
  tenders: [{ method: "CASH", amountMinor: 2500, changeMinor: 500 }],
  netMinor: 2300,
  taxMinor: 200,
  totalMinor: 2500,
  footer: "Commercial receipt only.",
};
describe("receipt renderer", () => {
  it("formats integer pesewas", () => expect(money(2505)).toBe("GHS 25.05"));
  it("labels non-fiscal output and escapes snapshot text", () => {
    const html = renderReceiptHtml(snapshot);
    expect(html).toContain("NOT A FISCAL RECEIPT");
    expect(html).toContain("Demo &lt;Branch&gt;");
    expect(html).not.toContain("GRA");
  });
  it("marks reprints without changing the snapshot", () =>
    expect(renderReceiptHtml(snapshot, true)).toContain(
      "REPRINT - NOT A FISCAL RECEIPT",
    ));
});
