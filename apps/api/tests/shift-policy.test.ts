import { describe, expect, it } from "vitest";

import {
  cashCountTotal,
  normalizeDrawerKey,
  shiftActionIssue,
  shiftCloseApprovalRequired,
} from "../src/shifts/shift-policy.js";

describe("shift policy", () => {
  it("calculates denomination totals in integer pesewas", () => {
    expect(
      cashCountTotal([
        { denominationMinor: 5_000, count: 2 },
        { denominationMinor: 2_000, count: 3 },
      ]),
    ).toBe(16_000);
  });

  it("normalizes optional drawer keys deterministically", () => {
    expect(normalizeDrawerKey(" till-1 ")).toBe("TILL-1");
    expect(normalizeDrawerKey(null)).toBeNull();
  });

  it("requires approval for every non-zero foundational variance", () => {
    expect(shiftCloseApprovalRequired(10_000, 10_000)).toBe(false);
    expect(shiftCloseApprovalRequired(9_999, 10_000)).toBe(true);
  });

  it("rejects stale revisions and closed-shift actions", () => {
    expect(
      shiftActionIssue({
        status: "OPEN",
        actualRevision: 2,
        expectedRevision: 1,
      }),
    ).toBe("STALE_REVISION");
    expect(
      shiftActionIssue({
        status: "CLOSED",
        actualRevision: 2,
        expectedRevision: 2,
      }),
    ).toBe("NOT_OPEN");
  });
});
