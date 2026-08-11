export * from "./order-tax";

export type Money = Readonly<{
  amountMinor: number;
  currency: "GHS";
}>;

const ghsFormatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(amountMinor: number): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError("Money must be a safe integer number of pesewas.");
  }

  return { amountMinor, currency: "GHS" };
}

export function addMoney(values: readonly Money[]): Money {
  return money(values.reduce((total, value) => total + value.amountMinor, 0));
}

export function formatMoney(value: Money): string {
  return ghsFormatter.format(value.amountMinor / 100).replace("GH₵", "GH₵");
}
