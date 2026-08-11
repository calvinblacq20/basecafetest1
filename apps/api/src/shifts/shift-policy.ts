export type DenominationLine = Readonly<{
  denominationMinor: number;
  count: number;
}>;

export function cashCountTotal(lines: readonly DenominationLine[]): number {
  return lines.reduce(
    (total, line) => total + line.denominationMinor * line.count,
    0,
  );
}

export function normalizeDrawerKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

export function shiftCloseApprovalRequired(
  countedCashMinor: number,
  expectedCashMinor: number,
): boolean {
  return countedCashMinor !== expectedCashMinor;
}

export function shiftActionIssue(input: {
  status: "OPEN" | "CLOSED";
  actualRevision: number;
  expectedRevision: number;
}): "NOT_OPEN" | "STALE_REVISION" | null {
  if (input.actualRevision !== input.expectedRevision) return "STALE_REVISION";
  if (input.status !== "OPEN") return "NOT_OPEN";
  return null;
}
