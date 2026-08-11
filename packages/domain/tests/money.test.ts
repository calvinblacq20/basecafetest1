import { describe, expect, it } from "vitest";

import { addMoney, formatMoney, money } from "../src/index";

describe("money", () => {
  it("stores integer pesewas and adds without floating point drift", () => {
    expect(addMoney([money(5600), money(2200), money(4400)])).toEqual({
      amountMinor: 12200,
      currency: "GHS",
    });
  });

  it("rejects non-integer pesewa values", () => {
    expect(() => money(10.5)).toThrow(/safe integer/);
  });

  it("formats Ghana cedis consistently", () => {
    expect(formatMoney(money(20200))).toContain("202.00");
  });
});
