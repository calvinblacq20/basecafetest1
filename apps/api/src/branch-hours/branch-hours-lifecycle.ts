export type ScheduleActivationIssue =
  "NOT_DRAFT" | "PAST_EFFECTIVE_DATE" | "DUPLICATE_ACTIVE_START" | null;

export function scheduleActivationIssue(input: {
  status: "DRAFT" | "ACTIVE" | "CANCELLED";
  effectiveFrom: string;
  localToday: string;
  duplicateActiveStart: boolean;
}): ScheduleActivationIssue {
  if (input.status !== "DRAFT") return "NOT_DRAFT";
  if (input.effectiveFrom < input.localToday) return "PAST_EFFECTIVE_DATE";
  if (input.duplicateActiveStart) return "DUPLICATE_ACTIVE_START";
  return null;
}

export type ScheduleCancellationIssue =
  "NOT_ACTIVE" | "ALREADY_EFFECTIVE" | null;

export function scheduleCancellationIssue(input: {
  status: "DRAFT" | "ACTIVE" | "CANCELLED";
  effectiveFrom: string;
  localToday: string;
}): ScheduleCancellationIssue {
  if (input.status !== "ACTIVE") return "NOT_ACTIVE";
  if (input.effectiveFrom <= input.localToday) return "ALREADY_EFFECTIVE";
  return null;
}

export function specialHoursDateIssue(input: {
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "CANCELLED";
  requiredStatus: "DRAFT" | "ACTIVE";
  localDate: string;
  localToday: string;
}): "WRONG_STATUS" | "PAST_DATE" | null {
  if (input.status !== input.requiredStatus) return "WRONG_STATUS";
  if (input.localDate < input.localToday) return "PAST_DATE";
  return null;
}
