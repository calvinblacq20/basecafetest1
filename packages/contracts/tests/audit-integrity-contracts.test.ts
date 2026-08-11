import { describe, expect, it } from "vitest";

import {
  auditIntegrityBatchListQuerySchema,
  createAuditIntegrityBatchRequestSchema,
  verifyAuditIntegrityRequestSchema,
} from "../src/index.js";

describe("audit integrity contracts", () => {
  it("applies bounded defaults", () => {
    expect(auditIntegrityBatchListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      verifyAuditIntegrityRequestSchema.parse({ reason: "Quarterly review" }),
    ).toMatchObject({ fromSequence: 1, maxBatches: 100 });
  });

  it("requires a client id, UTC instant, and bounded event count", () => {
    expect(() =>
      createAuditIntegrityBatchRequestSchema.parse({
        batchId: "not-a-uuid",
        through: "2026-08-08",
        maxEvents: 5001,
        reason: "Review",
      }),
    ).toThrow();
  });
});
