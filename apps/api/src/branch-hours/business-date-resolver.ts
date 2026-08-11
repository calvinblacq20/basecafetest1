import type { ServiceWindow } from "./branch-hours-policy.js";

const weekdayByDate = (localDate: string): number => {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

export type LocalDateTime = Readonly<{
  localDate: string;
  localTime: string;
  minuteOfDay: number;
  isoWeekday: number;
}>;

export type WindowAnchor = Readonly<{
  localDate: string;
  scheduleVersionId: string | null;
  specialHoursId: string | null;
  source: "WEEKLY" | "SPECIAL_CLOSED" | "SPECIAL_CUSTOM" | "UNCONFIGURED";
  windows: readonly ServiceWindow[];
}>;

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((candidate) => candidate.type === type)?.value;
  if (!value) throw new RangeError(`Unable to resolve local ${type}.`);
  return value;
}

export function localDateTimeAt(
  instant: Date,
  timeZone: string,
): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const year = part(parts, "year");
  const month = part(parts, "month");
  const day = part(parts, "day");
  const hour = Number(part(parts, "hour"));
  const minute = Number(part(parts, "minute"));
  const localDate = `${year}-${month}-${day}`;
  return {
    localDate,
    localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + minute,
    isoWeekday: weekdayByDate(localDate),
  };
}

export function addLocalDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessDateFor(
  localDate: string,
  minuteOfDay: number,
  cutoffMinute: number,
): string {
  return minuteOfDay < cutoffMinute ? addLocalDays(localDate, -1) : localDate;
}

export function resolveOpenWindow(
  local: LocalDateTime,
  previousAnchor: WindowAnchor,
  currentAnchor: WindowAnchor,
) {
  const candidates = [
    { anchor: previousAnchor, offset: 1_440 + local.minuteOfDay },
    { anchor: currentAnchor, offset: local.minuteOfDay },
  ];
  for (const candidate of candidates) {
    const ordered = [...candidate.anchor.windows].sort(
      (left, right) => left.opensAtMinute - right.opensAtMinute,
    );
    for (const window of ordered) {
      if (
        candidate.offset >= window.opensAtMinute &&
        candidate.offset < window.opensAtMinute + window.durationMinutes
      ) {
        return {
          anchorDate: candidate.anchor.localDate,
          scheduleVersionId: candidate.anchor.scheduleVersionId,
          specialHoursId: candidate.anchor.specialHoursId,
          source: candidate.anchor.source,
          opensAtMinute: window.opensAtMinute,
          durationMinutes: window.durationMinutes,
          elapsedMinutes: candidate.offset - window.opensAtMinute,
        } as const;
      }
    }
  }
  return null;
}

export function isoWeekdayForDate(localDate: string): number {
  return weekdayByDate(localDate);
}
