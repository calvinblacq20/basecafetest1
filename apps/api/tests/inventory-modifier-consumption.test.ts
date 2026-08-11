import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { InventoryConsumptionService } from "../src/inventory-consumption/inventory-consumption.service.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);
const principal: AuthPrincipal = {
  userId: id(2),
  organizationId: id(3),
  deviceId: id(4),
  displayName: "Inventory lead",
  email: "inventory@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions: ["inventory.read"] }],
};

describe("modifier inventory consumption", () => {
  it("pins and applies explicit add/remove effects in integer micros", async () => {
    const baseItemId = id(12);
    const addedItemId = id(13);
    const prisma = {
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId: id(3) }),
      },
      orderLine: {
        findFirst: vi.fn().mockResolvedValue({
          id: id(5),
          orderId: id(6),
          menuItemId: id(7),
          variantId: null,
          stationId: id(8),
          quantity: 2,
          sendWaveId: id(9),
          sentAt: new Date("2026-08-07T12:00:00.000Z"),
          sentCancelledAt: null,
          order: { id: id(6), branchId },
          modifiers: [{ id: id(14), menuModifierId: id(15), quantity: 1 }],
        }),
      },
      inventoryDeductionPolicyVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: id(10), trigger: "SENT" }),
      },
      recipeVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: id(11),
          version: 1,
          yieldQuantityMicros: 1_000_000n,
          components: [
            {
              inventoryItemId: baseItemId,
              quantityMicros: 250_000n,
              inventoryItem: { id: baseItemId, name: "Base", isActive: true },
            },
          ],
        }),
      },
      modifierRecipeEffectVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: id(16),
            menuModifierId: id(15),
            affectsInventory: true,
            components: [
              {
                inventoryItemId: baseItemId,
                kind: "REMOVE",
                quantityMicros: 50_000n,
                inventoryItem: { id: baseItemId, name: "Base", isActive: true },
              },
              {
                inventoryItemId: addedItemId,
                kind: "ADD",
                quantityMicros: 100_000n,
                inventoryItem: {
                  id: addedItemId,
                  name: "Extra",
                  isActive: true,
                },
              },
            ],
          },
        ]),
      },
      inventoryConsumptionRouteVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: id(17),
            inventoryItemId: baseItemId,
            stationId: id(8),
            locationId: id(19),
            location: { id: id(19), name: "Prep", isActive: true },
          },
          {
            id: id(18),
            inventoryItemId: addedItemId,
            stationId: id(8),
            locationId: id(19),
            location: { id: id(19), name: "Prep", isActive: true },
          },
        ]),
      },
    } as unknown as PrismaService;

    const result = await new InventoryConsumptionService(prisma).preview(
      {
        branchId,
        orderLineId: id(5),
        sourceEventId: id(9),
        trigger: "SENT",
      },
      principal,
    );
    expect(result).toMatchObject({
      modifierEffects: [
        {
          orderLineModifierId: id(14),
          effectVersionId: id(16),
          modifierQuantity: 1,
        },
      ],
      entries: [
        { inventoryItemId: baseItemId, quantityMicros: "400000" },
        { inventoryItemId: addedItemId, quantityMicros: "200000" },
      ],
    });
  });

  it("does nothing automatically until a matching policy is active", async () => {
    const findMany = vi.fn();
    const tx = {
      inventoryDeductionPolicyVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      inventoryConsumption: { findMany },
    } as never;
    await expect(
      new InventoryConsumptionService({} as PrismaService).postAutomatically(
        tx,
        {
          branchId,
          orderLineIds: [id(5)],
          sourceEventId: id(9),
          trigger: "SENT",
          occurredAt: new Date("2026-08-07T12:00:00.000Z"),
          reason: "Automatic stock dispatch",
        },
        principal,
      ),
    ).resolves.toEqual({ enabled: false, postedConsumptionIds: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});
