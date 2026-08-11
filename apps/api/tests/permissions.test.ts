import { describe, expect, it } from "vitest";

import {
  hasAnyScopePermission,
  hasPermission,
  type AuthPrincipal,
} from "../src/auth/auth.types.js";

const principal: AuthPrincipal = {
  userId: "10000000-0000-4000-8000-000000000010",
  organizationId: "10000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000003",
  displayName: "Demo user",
  email: "demo@example.invalid",
  mustChangePassword: false,
  assignments: [
    {
      branchId: "10000000-0000-4000-8000-000000000002",
      scope: "BRANCH",
      permissions: ["catalog.read", "catalog.write"],
    },
  ],
};

describe("branch-scoped permissions", () => {
  it("allows the assigned branch", () => {
    expect(
      hasPermission(
        principal,
        "catalog.write",
        "10000000-0000-4000-8000-000000000002",
      ),
    ).toBe(true);
  });

  it("rejects another branch while still exposing the coarse guard match", () => {
    expect(
      hasPermission(
        principal,
        "catalog.write",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
    expect(hasAnyScopePermission(principal, "catalog.write")).toBe(true);
  });
});
