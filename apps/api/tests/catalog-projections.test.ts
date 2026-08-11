import { menuItemConfigurationListResponseSchema } from "@base-cafe/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { CatalogConfigurationService } from "../src/catalog/catalog-configuration.service.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const principal: AuthPrincipal = {
  userId: "10000000-0000-4000-8000-000000000010",
  organizationId: "10000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000003",
  displayName: "Fictional manager",
  email: "manager@example.test",
  mustChangePassword: false,
  assignments: [{ branchId, scope: "BRANCH", permissions: ["catalog.read"] }],
};

describe("catalog response projections", () => {
  it("removes price actor IDs and returns schema-safe nested variants", async () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const price = {
      id: "10000000-0000-4000-8000-000000000070",
      branchId,
      menuItemId: "10000000-0000-4000-8000-000000000060",
      menuVariantId: null,
      createdById: principal.userId,
      amountMinor: 1_200,
      effectiveFrom: now,
      effectiveTo: null,
      createdAt: now,
    };
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      menuItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: price.menuItemId,
            branchId,
            externalKey: "FICTIONAL_ITEM",
            categoryId: "10000000-0000-4000-8000-000000000061",
            defaultStationId: "10000000-0000-4000-8000-000000000062",
            taxClassId: "10000000-0000-4000-8000-000000000063",
            name: "Fictional item",
            shortName: null,
            description: null,
            sku: null,
            imageUrl: null,
            isActive: false,
            revision: 1,
            isAvailable: true,
            unavailableFrom: null,
            unavailableTo: null,
            unavailableReason: null,
            createdAt: now,
            updatedAt: now,
            category: {
              id: "10000000-0000-4000-8000-000000000061",
              branchId,
              externalKey: "FICTIONAL_CATEGORY",
              name: "Fictional category",
              description: null,
              sortOrder: 0,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
            defaultStation: {
              id: "10000000-0000-4000-8000-000000000062",
              branchId,
              externalKey: "FICTIONAL_STATION",
              name: "Fictional station",
              kind: "KITCHEN",
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
            taxClass: {
              id: "10000000-0000-4000-8000-000000000063",
              branchId,
              key: "FICTIONAL_TAX",
              label: "Fictional tax",
              treatment: "ZERO_RATED",
              isActive: true,
              revision: 2,
              createdAt: now,
              updatedAt: now,
            },
            variants: [
              {
                id: "10000000-0000-4000-8000-000000000064",
                menuItemId: price.menuItemId,
                externalKey: "FICTIONAL_VARIANT",
                name: "Fictional variant",
                sku: null,
                isActive: false,
                revision: 1,
                isAvailable: true,
                unavailableFrom: null,
                unavailableTo: null,
                unavailableReason: null,
                createdAt: now,
                updatedAt: now,
                prices: [
                  {
                    ...price,
                    menuVariantId: "10000000-0000-4000-8000-000000000064",
                  },
                ],
              },
            ],
            prices: [price],
            modifierGroups: [],
          },
        ]),
      },
    };

    const result = await new CatalogConfigurationService(
      prisma as never,
    ).listMenuItems(branchId, principal);
    const json = JSON.parse(JSON.stringify(result));

    expect(menuItemConfigurationListResponseSchema.parse(json)).toHaveLength(1);
    expect(json[0].prices[0]).not.toHaveProperty("createdById");
    expect(json[0].variants[0].prices[0]).not.toHaveProperty("createdById");
    expect(prisma.menuItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          prices: expect.objectContaining({
            where: { menuVariantId: null },
          }),
        }),
      }),
    );
  });
});
