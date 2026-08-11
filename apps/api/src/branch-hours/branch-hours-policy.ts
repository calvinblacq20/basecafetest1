export type ServiceWindow = Readonly<{
  opensAtMinute: number;
  durationMinutes: number;
}>;

export type WeeklyServiceWindow = ServiceWindow &
  Readonly<{ isoWeekday: number }>;

type Segment = Readonly<{ start: number; end: number }>;

const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

function hasOverlap(segments: readonly Segment[]): boolean {
  const ordered = [...segments].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let previousEnd = -1;
  for (const segment of ordered) {
    if (segment.start < previousEnd) return true;
    previousEnd = Math.max(previousEnd, segment.end);
  }
  return false;
}

export function weeklyWindowsOverlap(
  windows: readonly WeeklyServiceWindow[],
): boolean {
  const segments: Segment[] = [];
  for (const window of windows) {
    const start =
      (window.isoWeekday - 1) * MINUTES_PER_DAY + window.opensAtMinute;
    const end = start + window.durationMinutes;
    if (end <= MINUTES_PER_WEEK) {
      segments.push({ start, end });
    } else {
      segments.push({ start, end: MINUTES_PER_WEEK });
      segments.push({ start: 0, end: end - MINUTES_PER_WEEK });
    }
  }
  return hasOverlap(segments);
}

export function specialWindowsOverlap(
  windows: readonly ServiceWindow[],
): boolean {
  return hasOverlap(
    windows.map((window) => ({
      start: window.opensAtMinute,
      end: window.opensAtMinute + window.durationMinutes,
    })),
  );
}

export function specialHoursConfigurationIssue(input: {
  kind: "CLOSED" | "CUSTOM_HOURS";
  windows: readonly ServiceWindow[];
}): "CLOSED_WITH_WINDOWS" | "CUSTOM_HOURS_EMPTY" | "WINDOWS_OVERLAP" | null {
  if (input.kind === "CLOSED" && input.windows.length > 0) {
    return "CLOSED_WITH_WINDOWS";
  }
  if (input.kind === "CUSTOM_HOURS" && input.windows.length === 0) {
    return "CUSTOM_HOURS_EMPTY";
  }
  if (specialWindowsOverlap(input.windows)) return "WINDOWS_OVERLAP";
  return null;
}
