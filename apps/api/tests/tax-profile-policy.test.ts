import { describe, expect, it } from "vitest";

import {
  taxProfileActivationIssue,
  taxProfileIntervalsOverlap,
} from "../src/tax/tax-profile-policy.js";

const now = new Date("2026-08-06T12:00:00.000Z");

describe("tax profile lifecycle policy", () => {
  it("blocks activation until approval evidence is recorded", () => {
    expect(
      taxProfileActivationIssue({
        status: "DRAFT",
        approvalReference: null,
        confirmationRecordedById: null,
        confirmedAt: null,
        effectiveTo: null,
        now,
      }),
    ).toBe("APPROVAL_NOT_RECORDED");
  });

  it("blocks activation after the effective interval expired", () => {
    expect(
      taxProfileActivationIssue({
        status: "CONFIRMED",
        approvalReference: "accountant-evidence-reference",
        confirmationRecordedById: "10000000-0000-4000-8000-000000000010",
        confirmedAt: now,
        effectiveTo: new Date("2026-08-06T11:59:59.999Z"),
        now,
      }),
    ).toBe("ALREADY_EXPIRED");
  });

  it("treats adjacent half-open profile intervals as non-overlapping", () => {
    expect(
      taxProfileIntervalsOverlap(
        {
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
        },
        {
          effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
          effectiveTo: null,
        },
      ),
    ).toBe(false);
  });
});
