import { ConflictException } from "@nestjs/common";
import {
  addLocalDays,
  localDateTimeAt,
} from "../branch-hours/business-date-resolver.js";

export type MoneyTotals = Readonly<{
  inputSubtotalMinor: number;
  netTotalMinor: number;
  taxTotalMinor: number;
  grossTotalMinor: number;
}>;

export const zeroMoney = (): MoneyTotals => ({
  inputSubtotalMinor: 0,
  netTotalMinor: 0,
  taxTotalMinor: 0,
  grossTotalMinor: 0,
});

export function checkedSum(values: readonly number[]): number {
  const result = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new ConflictException({
      code: "REPORT_TOTAL_OVERFLOW",
      message: "A report total exceeds the supported JSON integer range.",
    });
  }
  return Number(result);
}

export function addMoney(left: MoneyTotals, right: MoneyTotals): MoneyTotals {
  return {
    inputSubtotalMinor: checkedSum([
      left.inputSubtotalMinor,
      right.inputSubtotalMinor,
    ]),
    netTotalMinor: checkedSum([left.netTotalMinor, right.netTotalMinor]),
    taxTotalMinor: checkedSum([left.taxTotalMinor, right.taxTotalMinor]),
    grossTotalMinor: checkedSum([left.grossTotalMinor, right.grossTotalMinor]),
  };
}

export function inclusiveDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let date = fromDate; date <= toDate; date = addLocalDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function localActivity(
  instant: Date,
  timezone: string,
): { date: string; hour: string } {
  const local = localDateTimeAt(instant, timezone);
  return { date: local.localDate, hour: local.localTime.slice(0, 2) };
}

export function inRange(date: string, fromDate: string, toDate: string) {
  return date >= fromDate && date <= toDate;
}

export function broadUtcRange(fromDate: string, toDate: string) {
  return {
    gte: new Date(`${addLocalDays(fromDate, -1)}T00:00:00.000Z`),
    lt: new Date(`${addLocalDays(toDate, 2)}T00:00:00.000Z`),
  };
}

export function opaqueCursor(value: {
  occurredAt: string;
  type: string;
  id: string;
}) {
  return Buffer.from(
    `${value.occurredAt}\u0000${value.type}\u0000${value.id}`,
    "utf8",
  ).toString("base64url");
}
