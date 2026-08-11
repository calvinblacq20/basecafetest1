import { describe, expect, it } from "vitest";

import { calculateOrder } from "../src/orders/order-calculator.js";

const component = {
  id: "10000000-0000-4000-8000-000000000001",
  code: "VAT",
  receiptLabel: "VAT",
  ratePpm: 150_000,
  calculationOrder: 1,
};

describe("order calculator", () => {
  it("calculates exclusive line rounding", () => {
    const result = calculateOrder(
      [{ id: "line-a", amountMinor: 1000, treatment: "STANDARD" }],
      {
        priceMode: "EXCLUSIVE",
        roundingMode: "HALF_UP",
        roundingScope: "LINE",
        components: [component],
      },
    );
    expect(result.lines.get("line-a")).toMatchObject({
      netAmountMinor: 1000,
      taxTotalMinor: 150,
      grossAmountMinor: 1150,
    });
    expect(result.totals.grossTotalMinor).toBe(1150);
  });

  it("preserves inclusive input as gross", () => {
    const result = calculateOrder(
      [{ id: "line-a", amountMinor: 1150, treatment: "STANDARD" }],
      {
        priceMode: "INCLUSIVE",
        roundingMode: "HALF_UP",
        roundingScope: "LINE",
        components: [component],
      },
    );
    expect(result.lines.get("line-a")).toMatchObject({
      netAmountMinor: 1000,
      taxTotalMinor: 150,
      grossAmountMinor: 1150,
    });
  });

  it("allocates invoice rounding by largest remainder with lexical ties", () => {
    const result = calculateOrder(
      [
        { id: "a", amountMinor: 1, treatment: "STANDARD" },
        { id: "b", amountMinor: 1, treatment: "STANDARD" },
        { id: "c", amountMinor: 1, treatment: "STANDARD" },
        { id: "d", amountMinor: 1, treatment: "STANDARD" },
      ],
      {
        priceMode: "EXCLUSIVE",
        roundingMode: "HALF_UP",
        roundingScope: "INVOICE",
        components: [{ ...component, ratePpm: 250_000 }],
      },
    );
    expect(result.totals.taxTotalMinor).toBe(1);
    expect(result.lines.get("a")?.taxTotalMinor).toBe(1);
    expect(result.lines.get("b")?.taxTotalMinor).toBe(0);
    expect(result.totals.grossTotalMinor).toBe(5);
  });

  it("keeps non-taxable treatment at zero tax", () => {
    const result = calculateOrder(
      [{ id: "z", amountMinor: 900, treatment: "ZERO_RATED" }],
      {
        priceMode: "EXCLUSIVE",
        roundingMode: "HALF_UP",
        roundingScope: "INVOICE",
        components: [component],
      },
    );
    expect(result.lines.get("z")?.taxTotalMinor).toBe(0);
  });
});
