import { describe, expect, it, vi } from "vitest";

import { AdministrationService } from "../src/administration/administration.service.js";
import type { AuthPrincipal } from "../src/auth/auth.types.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const principal: AuthPrincipal = {
  userId: "10000000-0000-4000-8000-000000000010",
  organizationId: "10000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000003",
  displayName: "Demo manager",
  email: "manager@example.test",
  mustChangePassword: false,
  assignments: [
    {
      branchId,
      scope: "BRANCH",
      permissions: ["roles.manage"],
    },
  ],
};

describe("administration response projections", () => {
  it("returns stable roles with sorted permission keys", async () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      role: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "10000000-0000-4000-8000-000000000004",
            organizationId: principal.organizationId,
            name: "Manager",
            scope: "BRANCH",
            isSystem: false,
            createdAt: now,
            updatedAt: now,
            permissions: [
              { permissionKey: "staff.manage" },
              { permissionKey: "device.manage" },
            ],
          },
        ]),
      },
    };

    const result = await new AdministrationService(prisma as never).listRoles(
      branchId,
      principal,
    );

    expect(result).toEqual([
      {
        id: "10000000-0000-4000-8000-000000000004",
        name: "Manager",
        scope: "BRANCH",
        isSystem: false,
        permissionKeys: ["device.manage", "staff.manage"],
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(result[0]).not.toHaveProperty("organizationId");
  });
});
