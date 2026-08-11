import { describe, expect, it } from "vitest";

import {
  createCategoryRequestSchema,
  idempotencyKeySchema,
  loginRequestSchema,
} from "../src/index.js";

describe("backend contracts", () => {
  it("accepts integer category ordering and normalizes names", () => {
    const result = createCategoryRequestSchema.parse({
      branchId: "10000000-0000-4000-8000-000000000002",
      name: "  Drinks  ",
      reason: "Create a fictional test category.",
    });
    expect(result.name).toBe("Drinks");
    expect(result.sortOrder).toBe(0);
  });

  it("rejects short passwords and unsafe retry keys", () => {
    expect(
      loginRequestSchema.safeParse({
        email: "demo@example.invalid",
        password: "too-short",
        deviceId: "10000000-0000-4000-8000-000000000003",
      }).success,
    ).toBe(false);
    expect(idempotencyKeySchema.safeParse("spaces are unsafe").success).toBe(
      false,
    );
    expect(
      loginRequestSchema.safeParse({
        email: "demo@example.invalid",
        password: "safe-demo-password",
        deviceId: "10000000-0000-4000-8000-000000000003",
        deviceFingerprintHash: "not-a-sha256-hash",
      }).success,
    ).toBe(false);
  });
});
