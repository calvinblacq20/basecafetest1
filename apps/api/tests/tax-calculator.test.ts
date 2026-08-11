import { describe, expect, it } from "vitest";

import {
  calculateTax,
  type TaxCalculationInput,
} from "../src/tax/tax-calculator.js";

const approvedExampleComponents = [
  {
    code: "COMPONENT_A",
    receiptLabel: "Component A",
    ratePpm: 150_000,
    calculationOrder: 0,
  },
  {
    code: "COMPONENT_B",
    receiptLabel: "Component B",
    ratePpm: 25_000,
    calculationOrder: 1,
  },
  {
    code: "COMPONENT_C",
    receiptLabel: "Component C",
    ratePpm: 25_000,
    calculationOrder: 2,
  },
] as const;

function input(
  overrides: Partial<TaxCalculationInput> = {},
): TaxCalculationInput {
  return {
    amountMinor: 1_000,
    treatment: "STANDARD",
    priceMode: "EXCLUSIVE",
    roundingMode: "HALF_UP",
    roundingScope: "LINE",
    components: approvedExampleComponents,
    ...overrides,
  };
}

describe("deterministic integer tax calculation", () => {
  it("adds separately rounded components to an exclusive amount", () => {
    const result = calculateTax(input());
    expect(result.taxableBaseMinor).toBe(1_000);
    expect(result.components.map((component) => component.amountMinor)).toEqual(
      [150, 25, 25],
    );
    expect(result.taxTotalMinor).toBe(200);
    expect(result.grossAmountMinor).toBe(1_200);
  });

  it("back-calculates and reconciles an inclusive amount exactly", () => {
    const result = calculateTax(
      input({ amountMinor: 1_200, priceMode: "INCLUSIVE" }),
    );
    expect(result.netAmountMinor).toBe(1_000);
    expect(result.components.map((component) => component.amountMinor)).toEqual(
      [150, 25, 25],
    );
    expect(result.netAmountMinor + result.taxTotalMinor).toBe(
      result.grossAmountMinor,
    );
  });

  it("keeps inclusive component allocation exact across rounding boundaries", () => {
    for (let amountMinor = 0; amountMinor <= 5_000; amountMinor += 1) {
      const result = calculateTax(
        input({ amountMinor, priceMode: "INCLUSIVE" }),
      );
      expect(
        result.components.reduce(
          (sum, component) => sum + component.amountMinor,
          0,
        ),
      ).toBe(result.taxTotalMinor);
      expect(result.netAmountMinor + result.taxTotalMinor).toBe(amountMinor);
    }
  });

  it("implements half-up, half-even, and down without floating point", () => {
    const component = [
      {
        code: "HALF",
        receiptLabel: "Half",
        ratePpm: 500_000,
        calculationOrder: 0,
      },
    ];
    expect(
      calculateTax(
        input({
          amountMinor: 1,
          components: component,
          roundingMode: "HALF_UP",
        }),
      ).taxTotalMinor,
    ).toBe(1);
    expect(
      calculateTax(
        input({
          amountMinor: 1,
          components: component,
          roundingMode: "HALF_EVEN",
        }),
      ).taxTotalMinor,
    ).toBe(0);
    expect(
      calculateTax(
        input({ amountMinor: 1, components: component, roundingMode: "DOWN" }),
      ).taxTotalMinor,
    ).toBe(0);
  });

  it.each(["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const)(
    "does not apply components to %s classes",
    (treatment) => {
      const result = calculateTax(input({ treatment }));
      expect(result.taxTotalMinor).toBe(0);
      expect(result.components).toEqual([]);
      expect(result.grossAmountMinor).toBe(1_000);
    },
  );
});
