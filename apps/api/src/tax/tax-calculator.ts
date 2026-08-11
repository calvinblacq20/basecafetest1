import type { TaxTreatment } from "@base-cafe/contracts";

const RATE_SCALE = 1_000_000n;

export type TaxCalculationComponent = Readonly<{
  id?: string;
  code: string;
  receiptLabel: string;
  ratePpm: number;
  calculationOrder: number;
}>;

export type TaxCalculationInput = Readonly<{
  amountMinor: number;
  treatment: TaxTreatment;
  priceMode: "INCLUSIVE" | "EXCLUSIVE";
  roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN";
  roundingScope: "LINE" | "INVOICE";
  components: readonly TaxCalculationComponent[];
}>;

type RoundedShare = Readonly<{
  component: TaxCalculationComponent;
  floor: bigint;
  remainder: bigint;
}>;

function toSafeNumber(value: bigint, label: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return numberValue;
}

function roundDivision(
  numerator: bigint,
  denominator: bigint,
  mode: TaxCalculationInput["roundingMode"],
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === "DOWN" || remainder === 0n) return quotient;

  const comparison = remainder * 2n - denominator;
  if (comparison > 0n) return quotient + 1n;
  if (comparison < 0n) return quotient;
  if (mode === "HALF_UP") return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function orderedComponents(
  components: readonly TaxCalculationComponent[],
): TaxCalculationComponent[] {
  return [...components].sort(
    (left, right) =>
      left.calculationOrder - right.calculationOrder ||
      left.code.localeCompare(right.code),
  );
}

function validateInput(input: TaxCalculationInput) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative safe integer.");
  }
  for (const component of input.components) {
    if (
      !Number.isInteger(component.ratePpm) ||
      component.ratePpm < 0 ||
      component.ratePpm > Number(RATE_SCALE)
    ) {
      throw new RangeError("Tax component rates must be integer ppm values.");
    }
  }
}

function noTaxResult(input: TaxCalculationInput) {
  return {
    inputAmountMinor: input.amountMinor,
    taxableBaseMinor: input.amountMinor,
    netAmountMinor: input.amountMinor,
    taxTotalMinor: 0,
    grossAmountMinor: input.amountMinor,
    treatment: input.treatment,
    priceMode: input.priceMode,
    roundingMode: input.roundingMode,
    roundingScope: input.roundingScope,
    components: [],
  } as const;
}

export function calculateTax(input: TaxCalculationInput) {
  validateInput(input);
  if (input.treatment !== "STANDARD") return noTaxResult(input);

  const amount = BigInt(input.amountMinor);
  const components = orderedComponents(input.components);
  if (input.priceMode === "EXCLUSIVE") {
    let taxTotal = 0n;
    const calculatedComponents = components.map((component) => {
      const numerator = amount * BigInt(component.ratePpm);
      const floor = numerator / RATE_SCALE;
      const taxAmount = roundDivision(
        numerator,
        RATE_SCALE,
        input.roundingMode,
      );
      taxTotal += taxAmount;
      return {
        id: component.id,
        code: component.code,
        receiptLabel: component.receiptLabel,
        ratePpm: component.ratePpm,
        calculationOrder: component.calculationOrder,
        taxableBaseMinor: input.amountMinor,
        amountMinor: toSafeNumber(taxAmount, "Tax component"),
        roundingAdjustmentMinor: toSafeNumber(
          taxAmount - floor,
          "Rounding adjustment",
        ),
      };
    });
    const gross = amount + taxTotal;
    return {
      inputAmountMinor: input.amountMinor,
      taxableBaseMinor: input.amountMinor,
      netAmountMinor: input.amountMinor,
      taxTotalMinor: toSafeNumber(taxTotal, "Tax total"),
      grossAmountMinor: toSafeNumber(gross, "Gross amount"),
      treatment: input.treatment,
      priceMode: input.priceMode,
      roundingMode: input.roundingMode,
      roundingScope: input.roundingScope,
      components: calculatedComponents,
    } as const;
  }

  const totalRate = components.reduce(
    (sum, component) => sum + BigInt(component.ratePpm),
    0n,
  );
  if (totalRate === 0n) {
    return {
      ...noTaxResult(input),
      treatment: "STANDARD" as const,
      components: components.map((component) => ({
        id: component.id,
        code: component.code,
        receiptLabel: component.receiptLabel,
        ratePpm: component.ratePpm,
        calculationOrder: component.calculationOrder,
        taxableBaseMinor: input.amountMinor,
        amountMinor: 0,
        roundingAdjustmentMinor: 0,
      })),
    };
  }

  const denominator = RATE_SCALE + totalRate;
  const targetTax = roundDivision(
    amount * totalRate,
    denominator,
    input.roundingMode,
  );
  const shares: RoundedShare[] = components.map((component) => {
    const numerator = amount * BigInt(component.ratePpm);
    return {
      component,
      floor: numerator / denominator,
      remainder: numerator % denominator,
    };
  });
  const allocated = new Map(
    shares.map((share) => [share.component.code, share.floor]),
  );
  let remaining =
    targetTax - shares.reduce((sum, share) => sum + share.floor, 0n);
  const remainderOrder = [...shares].sort(
    (left, right) =>
      Number(right.remainder - left.remainder) ||
      left.component.calculationOrder - right.component.calculationOrder ||
      left.component.code.localeCompare(right.component.code),
  );
  for (const share of remainderOrder) {
    if (remaining === 0n) break;
    allocated.set(share.component.code, share.floor + 1n);
    remaining -= 1n;
  }
  if (remaining !== 0n) {
    throw new RangeError("Inclusive tax allocation did not reconcile.");
  }

  const taxableBase = amount - targetTax;
  const calculatedComponents = shares.map((share) => {
    const taxAmount = allocated.get(share.component.code) ?? share.floor;
    return {
      id: share.component.id,
      code: share.component.code,
      receiptLabel: share.component.receiptLabel,
      ratePpm: share.component.ratePpm,
      calculationOrder: share.component.calculationOrder,
      taxableBaseMinor: toSafeNumber(taxableBase, "Taxable base"),
      amountMinor: toSafeNumber(taxAmount, "Tax component"),
      roundingAdjustmentMinor: toSafeNumber(
        taxAmount - share.floor,
        "Rounding adjustment",
      ),
    };
  });

  return {
    inputAmountMinor: input.amountMinor,
    taxableBaseMinor: toSafeNumber(taxableBase, "Taxable base"),
    netAmountMinor: toSafeNumber(taxableBase, "Net amount"),
    taxTotalMinor: toSafeNumber(targetTax, "Tax total"),
    grossAmountMinor: input.amountMinor,
    treatment: input.treatment,
    priceMode: input.priceMode,
    roundingMode: input.roundingMode,
    roundingScope: input.roundingScope,
    components: calculatedComponents,
  } as const;
}
