import { afterEach, describe, expect, it } from "vitest";

import type { PrismaService } from "../src/database/prisma.service.js";
import {
  LoginThrottledException,
  LoginThrottleService,
} from "../src/auth/login-throttle.service.js";

const originalPepper = process.env.AUTH_THROTTLE_PEPPER;

afterEach(() => {
  if (originalPepper === undefined) delete process.env.AUTH_THROTTLE_PEPPER;
  else process.env.AUTH_THROTTLE_PEPPER = originalPepper;
});

describe("login throttle identifiers", () => {
  it("stores independent HMAC keys rather than raw account, device, or IP values", () => {
    process.env.AUTH_THROTTLE_PEPPER =
      "a-secure-test-pepper-with-more-than-32-characters";
    const service = new LoginThrottleService({} as PrismaService);
    const account = service.accountDimension(
      "10000000-0000-4000-8000-000000000001",
      "cashier@example.test",
    );
    const device = service.deviceDimension(
      "10000000-0000-4000-8000-000000000003",
    );
    const ip = service.ipDimension("::ffff:192.0.2.10");

    expect([account.scope, device.scope, ip.scope]).toEqual([
      "ACCOUNT",
      "DEVICE",
      "IP",
    ]);
    expect(new Set([account.keyHash, device.keyHash, ip.keyHash]).size).toBe(3);
    for (const dimension of [account, device, ip]) {
      expect(dimension.keyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(dimension.keyHash).not.toContain("cashier");
    }
  });

  it("returns a generic 429 exception with retry guidance", () => {
    process.env.AUTH_THROTTLE_PEPPER =
      "a-secure-test-pepper-with-more-than-32-characters";
    const service = new LoginThrottleService({} as PrismaService);
    const now = new Date("2026-08-06T12:00:00.000Z");

    expect(() =>
      service.throwIfLocked(
        {
          scopes: ["ACCOUNT"],
          lockedUntil: new Date("2026-08-06T12:00:30.000Z"),
        },
        now,
      ),
    ).toThrow(LoginThrottledException);
    try {
      service.throwIfLocked(
        {
          scopes: ["ACCOUNT"],
          lockedUntil: new Date("2026-08-06T12:00:30.000Z"),
        },
        now,
      );
    } catch (error) {
      expect((error as LoginThrottledException).getStatus()).toBe(429);
      expect((error as LoginThrottledException).retryAfterSeconds).toBe(30);
    }
  });
});
