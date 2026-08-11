import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { InventoryProductionService } from "../src/inventory-production/inventory-production.service.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);
const principal: AuthPrincipal = {
  userId: id(2),
  organizationId: id(3),
  deviceId: id(4),
  displayName: "Prep lead",
  email: "prep@example.test",
  mustChangePassword: false,
  assignments: [
    {
      scope: "BRANCH",
      branchId,
      permissions: ["inventory.read", "inventory.write", "inventory.manage"],
    },
  ],
};

const previewPrisma = (componentQuantity = 250_000n) =>
  ({
    branch: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: branchId, organizationId: id(3) }),
    },
    batchRecipeVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: id(5),
        version: 2,
        outputInventoryItemId: id(6),
        yieldQuantityMicros: 1_000_000n,
        outputInventoryItem: {
          id: id(6),
          name: "Prepared syrup",
          isActive: true,
        },
        components: [
          {
            inventoryItemId: id(7),
            quantityMicros: componentQuantity,
            inventoryItem: { id: id(7), name: "Sugar", isActive: true },
          },
        ],
      }),
    },
    stockLocation: {
      findMany: vi.fn().mockResolvedValue([{ id: id(8) }, { id: id(9) }]),
    },
  }) as unknown as PrismaService;

const preview = {
  branchId,
  batchRecipeVersionId: id(5),
  outputQuantityMicros: "2000000",
  outputLocationId: id(8),
  inputLocations: [{ inventoryItemId: id(7), locationId: id(9) }],
  occurredAt: "2026-08-07T12:00:00.000Z",
};

describe("inventory production service", () => {
  it("resolves exact batch input quantities without rounding", async () => {
    await expect(
      new InventoryProductionService(previewPrisma()).preview(
        preview,
        principal,
      ),
    ).resolves.toMatchObject({
      outputQuantityMicros: "2000000",
      inputs: [{ inventoryItemId: id(7), quantityMicros: "500000" }],
    });
  });

  it("rejects a batch quantity that requires fractional micros", async () => {
    await expect(
      new InventoryProductionService(previewPrisma(1n)).preview(
        { ...preview, outputQuantityMicros: "1500000" },
        principal,
      ),
    ).rejects.toMatchObject({
      response: { code: "BATCH_PRODUCTION_FRACTIONAL_MICRO" },
    });
  });

  it("combines item and location filters instead of overwriting either", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId: id(3) }),
      },
      batchProduction: { findMany },
    } as unknown as PrismaService;
    await new InventoryProductionService(prisma).listProductions(
      branchId,
      { inventoryItemId: id(6), locationId: id(8), limit: 100 },
      principal,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId,
          AND: [
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({ OR: expect.any(Array) }),
          ],
        }),
      }),
    );
  });

  it("selects modifier-effect projections without actor identifiers", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId: id(3) }),
      },
      modifierRecipeEffectVersion: { findMany },
    } as unknown as PrismaService;
    await new InventoryProductionService(prisma).listModifierEffects(
      branchId,
      principal,
    );
    const selection = findMany.mock.calls[0]?.[0]?.select;
    expect(selection).toBeDefined();
    expect(selection).not.toHaveProperty("createdById");
    expect(selection).not.toHaveProperty("activatedById");
  });
});
