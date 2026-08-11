import { describe, expect, it } from "vitest";

import {
  loadLoginThrottlePolicy,
  nextLoginThrottleState,
  retryAfterSeconds,
} from "../src/auth/login-throttle.policy.js";

const POLICY = { windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 };

describe("login throttle policy", () => {
  it("uses bounded configurable defaults", () => {
    const policy = loadLoginThrottlePolicy({
      AUTH_LOGIN_ACCOUNT_MAX_FAILURES: "1",
      AUTH_LOGIN_DEVICE_MAX_FAILURES: "not-a-number",
      AUTH_LOGIN_IP_MAX_FAILURES: "5000",
    });
    expect(policy.failureLimits).toEqual({ ACCOUNT: 2, DEVICE: 20, IP: 1_000 });
    expect(policy.windowMs).toBe(15 * 60_000);
  });

  it("locks when the failure threshold is reached", () => {
    const started = new Date("2026-08-06T12:00:00.000Z");
    let state = nextLoginThrottleState(null, started, 3, POLICY);
    state = nextLoginThrottleState(
      state,
      new Date(started.getTime() + 1_000),
      3,
      POLICY,
    );
    state = nextLoginThrottleState(
      state,
      new Date(started.getTime() + 2_000),
      3,
      POLICY,
    );
    expect(state.failureCount).toBe(3);
    expect(state.lockedUntil?.toISOString()).toBe("2026-08-06T12:15:02.000Z");
  });

  it("does not extend an active lock and resets after expiry", () => {
    const locked = {
      failureCount: 5,
      windowStartedAt: new Date("2026-08-06T12:00:00.000Z"),
      lockedUntil: new Date("2026-08-06T12:15:00.000Z"),
    };
    expect(
      nextLoginThrottleState(
        locked,
        new Date("2026-08-06T12:10:00.000Z"),
        5,
        POLICY,
      ),
    ).toEqual(locked);
    expect(
      nextLoginThrottleState(
        locked,
        new Date("2026-08-06T12:16:00.000Z"),
        5,
        POLICY,
      ).failureCount,
    ).toBe(1);
  });

  it("returns a whole-second retry duration", () => {
    expect(
      retryAfterSeconds(
        new Date("2026-08-06T12:00:01.001Z"),
        new Date("2026-08-06T12:00:00.000Z"),
      ),
    ).toBe(2);
  });
});
