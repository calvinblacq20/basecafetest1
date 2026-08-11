import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  businessDateFor,
  localDateTimeAt,
  resolveOpenWindow,
} from "../src/branch-hours/business-date-resolver.js";
import {
  specialHoursConfigurationIssue,
  specialWindowsOverlap,
  weeklyWindowsOverlap,
} from "../src/branch-hours/branch-hours-policy.js";

describe("branch-hours resolver", () => {
  it("converts UTC to Africa/Accra local parts deterministically", () => {
    expect(
      localDateTimeAt(new Date("2026-08-06T23:59:00.000Z"), "Africa/Accra"),
    ).toEqual({
      localDate: "2026-08-06",
      localTime: "23:59",
      minuteOfDay: 1_439,
      isoWeekday: 4,
    });
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      localDateTimeAt(new Date("2026-08-06T12:00:00.000Z"), "Invalid/Zone"),
    ).toThrow(RangeError);
  });

  it("assigns the previous date before cutoff and current date at cutoff", () => {
    expect(businessDateFor("2026-08-06", 239, 240)).toBe("2026-08-05");
    expect(businessDateFor("2026-08-06", 240, 240)).toBe("2026-08-06");
    expect(businessDateFor("2026-08-06", 241, 240)).toBe("2026-08-06");
  });

  it("crosses month and year boundaries without local-time arithmetic", () => {
    expect(addLocalDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("allows adjacent windows and rejects same-day overlap", () => {
    expect(
      specialWindowsOverlap([
        { opensAtMinute: 600, durationMinutes: 60 },
        { opensAtMinute: 660, durationMinutes: 60 },
      ]),
    ).toBe(false);
    expect(
      specialWindowsOverlap([
        { opensAtMinute: 600, durationMinutes: 61 },
        { opensAtMinute: 660, durationMinutes: 60 },
      ]),
    ).toBe(true);
  });

  it("detects weekly overlap across the Sunday-to-Monday boundary", () => {
    expect(
      weeklyWindowsOverlap([
        { isoWeekday: 7, opensAtMinute: 1_380, durationMinutes: 120 },
        { isoWeekday: 1, opensAtMinute: 30, durationMinutes: 60 },
      ]),
    ).toBe(true);
  });

  it("lets a previous-evening window finish through a current-date closure", () => {
    const local = {
      localDate: "2026-12-25",
      localTime: "01:00",
      minuteOfDay: 60,
      isoWeekday: 5,
    } as const;
    const result = resolveOpenWindow(
      local,
      {
        localDate: "2026-12-24",
        scheduleVersionId: "schedule-1",
        specialHoursId: null,
        source: "WEEKLY",
        windows: [{ opensAtMinute: 1_200, durationMinutes: 360 }],
      },
      {
        localDate: "2026-12-25",
        scheduleVersionId: "schedule-1",
        specialHoursId: "closure-1",
        source: "SPECIAL_CLOSED",
        windows: [],
      },
    );
    expect(result?.anchorDate).toBe("2026-12-24");
    expect(result?.elapsedMinutes).toBe(300);
  });

  it("validates closed and custom special-day semantics", () => {
    expect(
      specialHoursConfigurationIssue({
        kind: "CLOSED",
        windows: [{ opensAtMinute: 600, durationMinutes: 60 }],
      }),
    ).toBe("CLOSED_WITH_WINDOWS");
    expect(
      specialHoursConfigurationIssue({ kind: "CUSTOM_HOURS", windows: [] }),
    ).toBe("CUSTOM_HOURS_EMPTY");
  });
});
