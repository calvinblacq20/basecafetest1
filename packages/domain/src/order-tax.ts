export type TaxTreatment =
  "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";
export type TaxComponentConfiguration = Readonly<{
  id?: string;
  code: string;
  receiptLabel: string;
  ratePpm: number;
  calculationOrder: number;
}>;
export type OrderTaxConfiguration = Readonly<{
  priceMode: "INCLUSIVE" | "EXCLUSIVE";
  roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN";
  roundingScope: "LINE" | "INVOICE";
  components: readonly TaxComponentConfiguration[];
}>;
export type OrderCalculationLine = Readonly<{
  id: string;
  amountMinor: number;
  treatment: TaxTreatment;
}>;

const RATE_SCALE = 1_000_000n;

function safe(value: bigint, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new RangeError(`${label} exceeds safe integer range.`);
  return result;
}

function rounded(
  numerator: bigint,
  denominator: bigint,
  mode: OrderTaxConfiguration["roundingMode"],
) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === "DOWN" || remainder === 0n) return quotient;
  const comparison = remainder * 2n - denominator;
  if (comparison > 0n || (comparison === 0n && mode === "HALF_UP"))
    return quotient + 1n;
  if (comparison === 0n && quotient % 2n !== 0n) return quotient + 1n;
  return quotient;
}

function calculateTax(
  amountMinor: number,
  treatment: TaxTreatment,
  configuration: OrderTaxConfiguration,
) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError("Line amount must be a non-negative safe integer.");
  if (treatment !== "STANDARD" || configuration.components.length === 0)
    return {
      netAmountMinor: amountMinor,
      taxTotalMinor: 0,
      grossAmountMinor: amountMinor,
    };

  const amount = BigInt(amountMinor);
  const components = [...configuration.components].sort(
    (left, right) =>
      left.calculationOrder - right.calculationOrder ||
      left.code.localeCompare(right.code),
  );
  if (configuration.priceMode === "EXCLUSIVE") {
    const tax = components.reduce(
      (sum, component) =>
        sum +
        rounded(
          amount * BigInt(component.ratePpm),
          RATE_SCALE,
          configuration.roundingMode,
        ),
      0n,
    );
    return {
      netAmountMinor: amountMinor,
      taxTotalMinor: safe(tax, "Tax total"),
      grossAmountMinor: safe(amount + tax, "Gross amount"),
    };
  }

  const totalRate = components.reduce(
    (sum, component) => sum + BigInt(component.ratePpm),
    0n,
  );
  const tax = rounded(
    amount * totalRate,
    RATE_SCALE + totalRate,
    configuration.roundingMode,
  );
  return {
    netAmountMinor: safe(amount - tax, "Net amount"),
    taxTotalMinor: safe(tax, "Tax total"),
    grossAmountMinor: amountMinor,
  };
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
  let remaining =
    BigInt(total) - shares.reduce((sum, share) => sum + share.value, 0n);
  shares.sort((left, right) => {
    if (left.remainder !== right.remainder)
      return left.remainder > right.remainder ? -1 : 1;
    return left.line.id.localeCompare(right.line.id);
  });
  for (const share of shares) {
    if (remaining === 0n) break;
    share.value += 1n;
    remaining -= 1n;
  }
  return new Map(
    shares.map((share) => [share.line.id, safe(share.value, "Allocation")]),
  );
}

export function calculateOrderTotals(
  lines: readonly OrderCalculationLine[],
  configuration: OrderTaxConfiguration,
) {
  const results = new Map<
    string,
    { netAmountMinor: number; taxTotalMinor: number; grossAmountMinor: number }
  >();
  if (configuration.roundingScope === "LINE") {
    for (const line of lines)
      results.set(
        line.id,
        calculateTax(line.amountMinor, line.treatment, configuration),
      );
  } else {
    for (const treatment of [...new Set(lines.map((line) => line.treatment))]) {
      const group = lines.filter((line) => line.treatment === treatment);
      const aggregate = calculateTax(
        group.reduce((sum, line) => sum + line.amountMinor, 0),
        treatment,
        configuration,
      );
      const taxByLine = allocate(aggregate.taxTotalMinor, group);
      for (const line of group) {
        const tax = taxByLine.get(line.id) ?? 0;
        const net =
          configuration.priceMode === "INCLUSIVE"
            ? line.amountMinor - tax
            : line.amountMinor;
        results.set(line.id, {
          netAmountMinor: net,
          taxTotalMinor: tax,
          grossAmountMinor: net + tax,
        });
      }
    }
  }
  const values = [...results.values()];
  return {
    inputSubtotalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    netTotalMinor: values.reduce((sum, line) => sum + line.netAmountMinor, 0),
    taxTotalMinor: values.reduce((sum, line) => sum + line.taxTotalMinor, 0),
    grossTotalMinor: values.reduce(
      (sum, line) => sum + line.grossAmountMinor,
      0,
    ),
  };
}
