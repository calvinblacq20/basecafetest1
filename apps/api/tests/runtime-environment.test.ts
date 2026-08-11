import { describe, expect, it } from "vitest";

import {
  runtimeEnvironmentIssues,
  runtimePosture,
} from "../src/common/runtime-environment.js";

const base = {
  DATABASE_URL: "postgresql://app:secret@database:5432/base_cafe",
  PORT: "3100",
};

describe("runtime environment validation", () => {
  it("accepts the minimal development runtime", () => {
    expect(runtimeEnvironmentIssues(base)).toEqual([]);
  });

  it("requires explicit production origins and throttle secret", () => {
    expect(
      runtimeEnvironmentIssues({ ...base, NODE_ENV: "production" }).map(
        ({ code }) => code,
      ),
    ).toEqual(["AUTH_THROTTLE_PEPPER_MISSING", "CORS_ALLOWED_ORIGINS_INVALID"]);
  });

  it("blocks partially enabled retention and MFA execution", () => {
    expect(
      runtimeEnvironmentIssues({
        ...base,
        PRIVACY_RETENTION_ACTIVATION_ENABLED: "true",
        MFA_ENFORCEMENT_ENABLED: "true",
      }).map(({ code }) => code),
    ).toEqual([
      "MFA_ENFORCEMENT_UNAVAILABLE",
      "RETENTION_EXECUTION_INCOMPLETE",
    ]);
  });

  it("rejects fictional or unknown production adapters", () => {
    expect(
      runtimeEnvironmentIssues({
        ...base,
        NODE_ENV: "production",
        CORS_ALLOWED_ORIGINS: "https://pos.example.test",
        AUTH_THROTTLE_PEPPER: "x".repeat(32),
        PSP_ADAPTER: "fictional-test",
        NOTIFICATION_ADAPTER: "unknown-provider",
      }).map(({ code }) => code),
    ).toEqual(["ADAPTER_MODE_INVALID", "ADAPTER_NOT_PRODUCTION_APPROVED"]);
  });

  it("emits a secret-free structured runtime posture", () => {
    expect(runtimePosture({ ...base, APP_VERSION: "release-123" })).toEqual({
      event: "runtime.posture",
      version: "release-123",
      environment: "development",
      mfaEnrollment: false,
      mfaEnforcement: false,
      privacyRetentionExecution: false,
      adapters: {
        psp: "disabled",
        graFiscal: "disabled",
        printer: "browser",
        notification: "disabled",
      },
    });
  });
});
