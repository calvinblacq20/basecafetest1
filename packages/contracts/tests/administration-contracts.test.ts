import { describe, expect, it } from "vitest";

import {
  activateDeviceRequestSchema,
  changePasswordRequestSchema,
  createRoleRequestSchema,
  createStaffRequestSchema,
  deviceListResponseSchema,
  roleListResponseSchema,
  staffListResponseSchema,
} from "../src/administration.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const roleId = "10000000-0000-4000-8000-000000000004";

describe("administration contracts", () => {
  it("rejects duplicate role permissions and staff assignments", () => {
    expect(
      createRoleRequestSchema.safeParse({
        branchId,
        name: "Demo role",
        scope: "BRANCH",
        reason: "Define demo access",
        permissionKeys: ["catalog.read", "catalog.read"],
      }).success,
    ).toBe(false);
    expect(
      createStaffRequestSchema.safeParse({
        branchId,
        displayName: "Demo staff",
        email: "staff@example.invalid",
        initialPassword: "safe-demo-password",
        reason: "Create demo account",
        roleIds: [roleId, roleId],
      }).success,
    ).toBe(false);
  });

  it("requires a SHA-256 device fingerprint and positive revision", () => {
    expect(
      activateDeviceRequestSchema.safeParse({
        branchId,
        revision: 0,
        reason: "Approved terminal",
        fingerprintHash: "not-a-hash",
      }).success,
    ).toBe(false);
  });

  it("requires a different replacement password", () => {
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: "same-password-123",
        newPassword: "same-password-123",
      }).success,
    ).toBe(false);
  });

  it("parses stable staff, role and PII-safe device projections", () => {
    const now = "2026-08-09T12:00:00.000Z";
    expect(
      roleListResponseSchema.parse([
        {
          id: roleId,
          name: "Branch manager",
          scope: "BRANCH",
          isSystem: false,
          permissionKeys: ["staff.manage"],
          createdAt: now,
          updatedAt: now,
        },
      ]),
    ).toHaveLength(1);
    expect(
      staffListResponseSchema.parse([
        {
          id: roleId,
          email: "staff@example.test",
          displayName: "Demo staff",
          status: "ACTIVE",
          mustChangePassword: true,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          assignments: [],
        },
      ]),
    ).toHaveLength(1);
    expect(
      deviceListResponseSchema.parse([
        {
          id: roleId,
          branchId,
          name: "Demo terminal",
          status: "PENDING",
          revision: 1,
          fingerprintBound: false,
          enrolledAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ])[0],
    ).not.toHaveProperty("fingerprintHash");
  });
});
