import { describe, expect, it } from "vitest";

import {
  branchHoursConfigurationResponseSchema,
  branchHoursPreviewResponseSchema,
  createBranchScheduleRequestSchema,
  createSpecialHoursRequestSchema,
  updateBranchScheduleRequestSchema,
} from "../src/branch-hours.js";

const branchId = "10000000-0000-4000-8000-000000000002";

describe("branch-hours contracts", () => {
  it("accepts an overnight window represented by duration", () => {
    expect(
      createBranchScheduleRequestSchema.safeParse({
        branchId,
        effectiveFrom: "2026-08-07",
        businessDayCutoffMinute: 240,
        windows: [
          { isoWeekday: 5, opensAtMinute: 18 * 60, durationMinutes: 10 * 60 },
        ],
        reason: "Prepare an owner-confirmed schedule.",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid calendar dates and out-of-range cutoff minutes", () => {
    expect(
      createBranchScheduleRequestSchema.safeParse({
        branchId,
        effectiveFrom: "2026-02-30",
        businessDayCutoffMinute: 1_440,
        windows: [],
        reason: "Invalid example.",
      }).success,
    ).toBe(false);
  });

  it("requires a material schedule update", () => {
    expect(
      updateBranchScheduleRequestSchema.safeParse({
        branchId,
        revision: 1,
        reason: "No change.",
      }).success,
    ).toBe(false);
  });

  it("rejects windows on an explicitly closed special day", () => {
    expect(
      createSpecialHoursRequestSchema.safeParse({
        branchId,
        localDate: "2026-12-25",
        kind: "CLOSED",
        windows: [{ opensAtMinute: 720, durationMinutes: 60 }],
        reason: "Invalid closed-day example.",
      }).success,
    ).toBe(false);
  });

  it("requires windows for custom special hours", () => {
    expect(
      createSpecialHoursRequestSchema.safeParse({
        branchId,
        localDate: "2026-12-25",
        kind: "CUSTOM_HOURS",
        windows: [],
        reason: "Invalid custom-hours example.",
      }).success,
    ).toBe(false);
  });

  it("parses version history and a deterministic resolver response", () => {
    const now = "2026-08-09T12:00:00.000Z";
    expect(
      branchHoursConfigurationResponseSchema.parse({
        schedules: [
          {
            id: "10000000-0000-4000-8000-000000000030",
            branchId,
            createdById: "10000000-0000-4000-8000-000000000010",
            activatedById: null,
            endedById: null,
            effectiveFrom: "2026-08-10T00:00:00.000Z",
            businessDayCutoffMinute: 240,
            status: "DRAFT",
            revision: 1,
            activatedAt: null,
            endedAt: null,
            createdAt: now,
            updatedAt: now,
            windows: [],
          },
        ],
        specialHours: [],
      }).schedules,
    ).toHaveLength(1);
    expect(
      branchHoursPreviewResponseSchema.parse({
        branchId,
        timezone: "Africa/Accra",
        instant: now,
        local: {
          localDate: "2026-08-09",
          localTime: "12:00",
          minuteOfDay: 720,
          isoWeekday: 7,
        },
        configurationReady: false,
        businessDate: null,
        scheduleVersionId: null,
        isOpen: false,
        activeWindow: null,
        currentSource: "UNCONFIGURED",
        issues: [{ code: "CONFIGURATION_MISSING" }],
      }).issues[0]?.code,
    ).toBe("CONFIGURATION_MISSING");
  });
});
