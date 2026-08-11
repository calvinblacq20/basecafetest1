import { describe, expect, it } from "vitest";

import {
  capturePilotReadinessReviewRequestSchema,
  pilotReadinessListQuerySchema,
  recordPilotEvidenceRequestSchema,
} from "../src/index.js";

describe("pilot readiness contracts", () => {
  it("applies bounded pagination", () => {
    expect(pilotReadinessListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(() => pilotReadinessListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("accepts only defined evidence and non-empty reasons", () => {
    expect(
      recordPilotEvidenceRequestSchema.parse({
        evidenceId: "00000000-0000-4000-8000-000000000001",
        code: "OFFLINE_DRILL_PASSED",
        outcome: "CONFIRMED",
        observedAt: "2026-08-09T06:00:00.000Z",
        reason: "Witnessed outage and reconnect drill.",
      }),
    ).toMatchObject({ safeReference: null });
    expect(() =>
      capturePilotReadinessReviewRequestSchema.parse({
        reviewId: "00000000-0000-4000-8000-000000000002",
        reason: "",
      }),
    ).toThrow();
  });
});
