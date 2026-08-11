import {
  auditReviewQuerySchema,
  evaluateSecurityMonitoringRequestSchema,
  rewrapCustomerPiiRequestSchema,
  securitySessionListQuerySchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("security operations contracts", () => {
  it("bounds monitoring and key-rotation batches", () => {
    expect(
      evaluateSecurityMonitoringRequestSchema.parse({
        evaluationId: "00000000-0000-4000-8000-000000000001",
        asOf: "2026-08-08T12:00:00.000Z",
        reason: "Scheduled internal review.",
      }).windowMinutes,
    ).toBe(60);
    expect(() =>
      rewrapCustomerPiiRequestSchema.parse({
        sourceKeyVersion: "v1",
        limit: 101,
        reason: "Reviewed key rotation.",
      }),
    ).toThrow();
  });

  it("rejects inverted audit ranges and unbounded session pages", () => {
    expect(() =>
      auditReviewQuerySchema.parse({
        from: "2026-08-08T12:00:00.000Z",
        to: "2026-08-08T11:59:59.000Z",
      }),
    ).toThrow("range end");
    expect(() =>
      securitySessionListQuerySchema.parse({ limit: 201 }),
    ).toThrow();
  });
});
