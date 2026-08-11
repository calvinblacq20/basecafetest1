import type {
  TaxPriceMode,
  TaxRoundingMode,
  TaxRoundingScope,
  TaxTreatment,
} from "@prisma/client";

import {
  calculateTax,
  type TaxCalculationComponent,
} from "../tax/tax-calculator.js";

export type OrderCalculationLine = Readonly<{
  id: string;
  amountMinor: number;
  treatment: TaxTreatment;
}>;

export type OrderTaxConfiguration = Readonly<{
  priceMode: TaxPriceMode;
  roundingMode: TaxRoundingMode;
  roundingScope: TaxRoundingScope;
  components: readonly TaxCalculationComponent[];
}>;

type ComponentAllocation = ReturnType<
  typeof calculateTax
>["components"][number];

function safe(value: bigint, name: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new RangeError(`${name} exceeds safe integer range.`);
  return result;
}

function allocate(total: number, lines: readonly OrderCalculationLine[]) {
  const denominator = lines.reduce(
    (sum, line) => sum + BigInt(line.amountMinor),
    0n,
  );
  if (denominator === 0n) return new Map(lines.map((line) => [line.id, 0]));
  const shares = lines.map((line) => {
    const numerator = BigInt(total) * BigInt(line.amountMinor);
    return {
      line,
      value: numerator / denominator,
      remainder: numerator % denominator,
    };
  });
  let left =
    BigInt(total) - shares.reduce((sum, share) => sum + share.value, 0n);
  shares.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.line.id.localeCompare(b.line.id);
  });
  for (const share of shares) {
    if (left === 0n) break;
    share.value += 1n;
    left -= 1n;
  }
  return new Map(
    shares.map((share) => [share.line.id, safe(share.value, "Allocation")]),
  );
}

export function calculateOrder(
  lines: readonly OrderCalculationLine[],
  configuration: OrderTaxConfiguration,
) {
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor < 0)
      throw new RangeError("Line amount must be a non-negative safe integer.");
  }
  const results = new Map<
    string,
    {
      inputAmountMinor: number;
      netAmountMinor: number;
      taxTotalMinor: number;
      grossAmountMinor: number;
      components: readonly ComponentAllocation[];
    }
  >();

  if (configuration.roundingScope === "LINE") {
    for (const line of lines) {
      results.set(
        line.id,
        calculateTax({
          amountMinor: line.amountMinor,
          treatment: line.treatment,
          ...configuration,
        }),
      );
    }
  } else {
    const treatments = [...new Set(lines.map((line) => line.treatment))];
    for (const treatment of treatments) {
      const group = lines.filter((line) => line.treatment === treatment);
      const input = group.reduce((sum, line) => sum + line.amountMinor, 0);
      const aggregate = calculateTax({
        amountMinor: input,
        treatment,
        ...configuration,
      });
      const taxByLine = allocate(aggregate.taxTotalMinor, group);
      const componentByLine = aggregate.components.map((component) => ({
        component,
        values: allocate(component.amountMinor, group),
      }));
      for (const line of group) {
        const tax = taxByLine.get(line.id) ?? 0;
        const net =
          configuration.priceMode === "INCLUSIVE"
            ? line.amountMinor - tax
            : line.amountMinor;
        const gross = net + tax;
        results.set(line.id, {
          inputAmountMinor: line.amountMinor,
          netAmountMinor: net,
          taxTotalMinor: tax,
          grossAmountMinor: gross,
          components: componentByLine.map(({ component, values }) => ({
            ...component,
            taxableBaseMinor: net,
            amountMinor: values.get(line.id) ?? 0,
            roundingAdjustmentMinor: 0,
          })),
        });
      }
    }
  }

  const values = [...results.values()];
  return {
    lines: results,
    totals: {
      inputSubtotalMinor: values.reduce(
        (sum, line) => sum + line.inputAmountMinor,
        0,
      ),
      netTotalMinor: values.reduce((sum, line) => sum + line.netAmountMinor, 0),
      taxTotalMinor: values.reduce((sum, line) => sum + line.taxTotalMinor, 0),
      grossTotalMinor: values.reduce(
        (sum, line) => sum + line.grossAmountMinor,
        0,
      ),
    },
  };
}
