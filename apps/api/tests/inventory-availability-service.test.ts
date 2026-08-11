import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { InventoryAvailabilityService } from "../src/inventory-availability/inventory-availability.service.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);
const at = "2026-08-07T12:00:00.000Z";
const principal = (permissions: readonly string[]): AuthPrincipal => ({
  userId: id(2),
  organizationId: id(3),
  deviceId: id(4),
  displayName: "Shift lead",
  email: "lead@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});

const basePrisma = (overrides: Record<string, unknown> = {}) =>
  ({
    branch: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: branchId, organizationId: id(3) }),
    },
    menuItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: id(5),
        branchId,
        isActive: true,
        isAvailable: true,
        variants: [],
      }),
    },
    manualAvailabilityEvent: { findMany: vi.fn().mockResolvedValue([]) },
    criticalIngredientRuleVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    stockLedgerEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    ...overrides,
  }) as unknown as PrismaService;

const preview = {
  branchId,
  menuItemId: id(5),
  menuVariantId: null,
  quantity: 1,
  at,
};

describe("inventory availability service", () => {
  it("reports missing stock policy without blocking the catalog item", async () => {
    await expect(
      new InventoryAvailabilityService(basePrisma()).preview(
        preview,
        principal(["catalog.availability.read"]),
      ),
    ).resolves.toMatchObject({
      configured: false,
      available: true,
      issueCode: "STOCK_AVAILABILITY_POLICY_NOT_CONFIGURED",
    });
  });

  it("applies safety stock and returns a deterministic maximum quantity", async () => {
    const inventoryItemId = id(6);
    const locationId = id(7);
    const prisma = basePrisma({
      criticalIngredientRuleVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: id(8),
          version: 2,
          recipeVersion: {
            id: id(9),
            branchId,
            menuItemId: id(5),
            menuVariantId: null,
            status: "ACTIVE",
            effectiveFrom: new Date("2026-08-07T00:00:00.000Z"),
            yieldQuantityMicros: 1_000_000n,
            components: [{ inventoryItemId, quantityMicros: 250_000n }],
          },
          components: [
            {
              inventoryItemId,
              safetyStockMicros: 100_000n,
              inventoryItem: {
                id: inventoryItemId,
                name: "Critical ingredient",
                isActive: true,
              },
              locations: [{ locationId }],
            },
          ],
        }),
      },
      stockLedgerEntry: {
        groupBy: vi.fn().mockResolvedValue([
          {
            inventoryItemId,
            locationId,
            _sum: { quantityDeltaMicros: 600_000n },
          },
        ]),
      },
    });
    await expect(
      new InventoryAvailabilityService(prisma).preview(
        { ...preview, quantity: 3 },
        principal(["catalog.availability.read"]),
      ),
    ).resolves.toMatchObject({
      configured: true,
      available: false,
      issueCode: "CRITICAL_STOCK_INSUFFICIENT",
      maxSellableQuantity: "2",
      components: [
        {
          balanceMicros: "600000",
          safetyStockMicros: "100000",
          requiredQuantityMicros: "750000",
          available: false,
        },
      ],
    });
  });

  it("lets an effective manual 86 override missing stock configuration", async () => {
    const prisma = basePrisma({
      manualAvailabilityEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: id(10),
            targetKey: `ITEM:${id(5)}`,
            state: "UNAVAILABLE",
            expiresAt: null,
          },
        ]),
      },
    });
    await expect(
      new InventoryAvailabilityService(prisma).preview(
        preview,
        principal(["catalog.availability.read"]),
      ),
    ).resolves.toMatchObject({
      available: false,
      issueCode: "CATALOG_ENTRY_MANUALLY_UNAVAILABLE",
      manualEventId: id(10),
    });
  });

  it("blocks a selected modifier with an effective manual 86 event", async () => {
    const modifierId = id(11);
    const events = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: id(12),
          targetKey: `MODIFIER:${modifierId}`,
          state: "UNAVAILABLE",
          expiresAt: null,
        },
      ]);
    const prisma = basePrisma({
      manualAvailabilityEvent: { findMany: events },
    });
    const service = new InventoryAvailabilityService(prisma);
    await expect(
      service.assertOrderSelection(prisma as never, {
        branchId,
        menuItemId: id(5),
        menuVariantId: null,
        menuModifierIds: [modifierId],
        quantity: 1,
        at: new Date(at),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("checks read permission before querying", async () => {
    const prisma = basePrisma();
    await expect(
      new InventoryAvailabilityService(prisma).preview(preview, principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });
});
