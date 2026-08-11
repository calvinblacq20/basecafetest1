import { describe, expect, it } from "vitest";

import { calculateOrderTotals } from "../src/order-tax.js";

const configuration = {
  priceMode: "EXCLUSIVE" as const,
  roundingMode: "HALF_UP" as const,
  roundingScope: "INVOICE" as const,
  components: [
    { code: "VAT", receiptLabel: "VAT", ratePpm: 150_000, calculationOrder: 1 },
  ],
};

describe("shared offline order totals", () => {
  it("allocates invoice tax deterministically with lexical ties", () => {
    expect(
      calculateOrderTotals(
        [
          { id: "b", amountMinor: 5, treatment: "STANDARD" },
          { id: "a", amountMinor: 5, treatment: "STANDARD" },
        ],
        configuration,
      ),
    ).toEqual({
      inputSubtotalMinor: 10,
      netTotalMinor: 10,
      taxTotalMinor: 2,
      grossTotalMinor: 12,
    });
  });

  it("keeps exempt lines untaxed", () => {
    expect(
      calculateOrderTotals(
        [{ id: "a", amountMinor: 1000, treatment: "EXEMPT" }],
        configuration,
      ).taxTotalMinor,
    ).toBe(0);
  });
});
