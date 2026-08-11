import { describe, expect, it } from "vitest";

import {
  scheduleActivationIssue,
  scheduleCancellationIssue,
  specialHoursDateIssue,
} from "../src/branch-hours/branch-hours-lifecycle.js";

describe("branch-hours lifecycle policy", () => {
  it("blocks past and duplicate schedule activation", () => {
    expect(
      scheduleActivationIssue({
        status: "DRAFT",
        effectiveFrom: "2026-08-05",
        localToday: "2026-08-06",
        duplicateActiveStart: false,
      }),
    ).toBe("PAST_EFFECTIVE_DATE");
    expect(
      scheduleActivationIssue({
        status: "DRAFT",
        effectiveFrom: "2026-08-06",
        localToday: "2026-08-06",
        duplicateActiveStart: true,
      }),
    ).toBe("DUPLICATE_ACTIVE_START");
  });

  it("only cancels an active schedule before its effective date", () => {
    expect(
      scheduleCancellationIssue({
        status: "ACTIVE",
        effectiveFrom: "2026-08-06",
        localToday: "2026-08-06",
      }),
    ).toBe("ALREADY_EFFECTIVE");
    expect(
      scheduleCancellationIssue({
        status: "ACTIVE",
        effectiveFrom: "2026-08-07",
        localToday: "2026-08-06",
      }),
    ).toBeNull();
  });

  it("allows same-day special activation/cancellation but locks past dates", () => {
    expect(
      specialHoursDateIssue({
        status: "DRAFT",
        requiredStatus: "DRAFT",
        localDate: "2026-08-06",
        localToday: "2026-08-06",
      }),
    ).toBeNull();
    expect(
      specialHoursDateIssue({
        status: "ACTIVE",
        requiredStatus: "ACTIVE",
        localDate: "2026-08-05",
        localToday: "2026-08-06",
      }),
    ).toBe("PAST_DATE");
  });
});
