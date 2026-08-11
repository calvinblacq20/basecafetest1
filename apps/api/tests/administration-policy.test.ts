import { describe, expect, it } from "vitest";

import {
  roleRemovalIssue,
  ungrantablePermissions,
} from "../src/administration/administration-policy.js";
import type { AuthPrincipal } from "../src/auth/auth.types.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const principal: AuthPrincipal = {
  userId: "10000000-0000-4000-8000-000000000010",
  organizationId: "10000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000003",
  displayName: "Demo manager",
  email: "manager@example.invalid",
  mustChangePassword: false,
  assignments: [
    {
      branchId,
      scope: "BRANCH",
      permissions: ["staff.manage", "catalog.read"],
    },
  ],
};

describe("administration permission policy", () => {
  it("allows only permissions held at the target branch", () => {
    expect(
      ungrantablePermissions(
        principal,
        ["catalog.read", "tax.configure"],
        "BRANCH",
        branchId,
      ),
    ).toEqual(["tax.configure"]);
  });

  it("does not treat a branch grant as organization-wide", () => {
    expect(
      ungrantablePermissions(
        principal,
        ["catalog.read"],
        "ORGANIZATION",
        branchId,
      ),
    ).toEqual(["catalog.read"]);
  });

  it("blocks self-removal and removal of the final active assignment", () => {
    expect(roleRemovalIssue(principal.userId, principal.userId, 2)).toBe(
      "SELF_REMOVAL",
    );
    expect(roleRemovalIssue(principal.userId, "another-user", 1)).toBe(
      "LAST_ACTIVE_ASSIGNMENT",
    );
    expect(roleRemovalIssue(principal.userId, "another-user", 2)).toBeNull();
  });
});
