import { describe, expect, it } from "vitest";

import {
  deploymentPreflight,
  readinessResult,
  requiredPilotEvidence,
} from "../src/operations/pilot-readiness-policy.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedAt = new Date("2026-08-09T06:00:00.000Z");

describe("pilot readiness policy", () => {
  it("reports safe deployment booleans without exposing secret values", () => {
    const check = deploymentPreflight({
      NODE_ENV: "production",
      APP_VERSION: "1.0.0",
      DATABASE_URL: "postgresql://prod.example.test/base?sslmode=verify-full",
      AUTH_THROTTLE_PEPPER: "x".repeat(32),
      CUSTOMER_PII_ACTIVE_KEY_VERSION: "v2",
      CUSTOMER_PII_KEYS_JSON: JSON.stringify({ v2: "not-returned" }),
      CUSTOMER_PII_BLIND_INDEX_KEY_B64: "also-not-returned",
      BACKUP_ENABLED: "true",
      BACKUP_DIRECTORY: "E:/approved/backups",
      BACKUP_ENCRYPTION_KEY_B64: "not-returned",
      BACKUP_RETENTION_DAYS: "30",
      NEXT_PUBLIC_API_BASE_URL: "https://pos.example.test/api/v1",
    });
    expect(check.status).toBe("PASS");
    expect(JSON.stringify(check)).not.toContain("also-not-returned");
  });

  it("never treats missing external confirmations as ready", () => {
    const result = readinessResult(
      organizationId,
      generatedAt,
      [
        {
          code: "AUTOMATED_OK",
          category: "AUTOMATED",
          status: "PASS",
          summary: "Automated configuration passed.",
        },
      ],
      new Map(),
    );
    expect(result.status).toBe("UNCONFIRMED");
    expect(result.counts.unconfirmed).toBe(requiredPilotEvidence.length);
  });

  it("blocks failed evidence even when every other check passes", () => {
    const evidence = new Map(
      requiredPilotEvidence.map(({ code }, index) => [
        code,
        {
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          outcome: code === "OFFLINE_DRILL_PASSED" ? "FAILED" : "CONFIRMED",
          observedAt: generatedAt,
        },
      ]),
    );
    const result = readinessResult(organizationId, generatedAt, [], evidence);
    expect(result.status).toBe("BLOCKED");
    expect(result.blockingCodes).toEqual(["OFFLINE_DRILL_PASSED"]);
  });

  it("becomes ready only when automated and evidence checks pass", () => {
    const evidence = new Map(
      requiredPilotEvidence.map(({ code }, index) => [
        code,
        {
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          outcome: "CONFIRMED",
          observedAt: generatedAt,
        },
      ]),
    );
    const result = readinessResult(
      organizationId,
      generatedAt,
      [
        {
          code: "AUTOMATED_OK",
          category: "AUTOMATED",
          status: "PASS",
          summary: "Automated configuration passed.",
        },
      ],
      evidence,
    );
    expect(result.status).toBe("READY");
    expect(result.counts.blocked).toBe(0);
    expect(result.counts.unconfirmed).toBe(0);
  });
});
