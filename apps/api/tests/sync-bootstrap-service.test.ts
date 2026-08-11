import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { SyncBootstrapService } from "../src/sync/sync-bootstrap.service.js";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);

const principal: AuthPrincipal = {
  userId: id(2),
  deviceId: id(3),
  organizationId: id(4),
  displayName: "Cashier",
  email: "cashier@example.test",
  mustChangePassword: false,
  assignments: [
    {
      branchId,
      scope: "BRANCH",
      permissions: ["catalog.read", "orders.read", "shifts.read"],
    },
  ],
};

function setup() {
  const now = new Date("2026-08-07T12:00:00.000Z");
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const prisma = {
    branch: {
      findFirst: vi.fn().mockResolvedValue({
        id: branchId,
        name: "Base Cafe",
        timezone: "Africa/Accra",
        currency: "GHS",
      }),
    },
    staffShift: { findFirst: vi.fn().mockResolvedValue(null) },
    diningTable: { findMany: vi.fn().mockResolvedValue([]) },
    menuItem: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: id(10),
          name: "Configured item",
          imageUrl: null,
          isActive: true,
          isAvailable: true,
          unavailableFrom: null,
          unavailableTo: null,
          category: { id: id(11), name: "Meals" },
          taxClass: { isActive: true, treatment: "STANDARD" },
          variants: [],
          prices: [
            {
              menuVariantId: null,
              currency: "GHS",
              amountMinor: 2500,
              effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
              effectiveTo: null,
            },
          ],
          modifierGroups: [],
        },
      ]),
    },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    taxProfile: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { service: new SyncBootstrapService(prisma as never), prisma };
}

describe("SyncBootstrapService", () => {
  it("returns only safe device working data with exact effective prices", async () => {
    const { service, prisma } = setup();
    const result = await service.load(branchId, principal);
    expect(result.catalog[0]).toMatchObject({
      menuItemId: id(10),
      priceMinor: 2500,
      taxTreatment: "STANDARD",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /phone|direction|externalReference/i,
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: principal.deviceId }),
      }),
    );
    vi.useRealTimers();
  });

  it("requires every cached-working-data permission", async () => {
    const { service } = setup();
    await expect(
      service.load(branchId, { ...principal, assignments: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    vi.useRealTimers();
  });
});
