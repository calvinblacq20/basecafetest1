import { describe, expect, it } from "vitest";
import { renderRefundHtml } from "../src/refunds/refund-renderer.js";
describe("refund renderer", () => {
  it("never presents a refund as an official credit note", () => {
    const html = renderRefundHtml({
      label: "NOT A FISCAL CREDIT NOTE",
      refundId: "refund-1",
      receiptNumber: "R-1",
      orderNumber: "O-1",
      paymentMethod: "CASH",
      kind: "REFUND",
      amountMinor: 505,
      currency: "GHS",
      confirmedAt: "2026-08-07T00:00:00Z",
      reason: "Customer return <verified>",
    });
    expect(html).toContain("NOT A FISCAL CREDIT NOTE");
    expect(html).toContain("-GHS 5.05");
    expect(html).toContain("&lt;verified&gt;");
    expect(html).not.toContain("GRA");
  });
});
