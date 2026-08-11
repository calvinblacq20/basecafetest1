import { stockLedgerListResponseSchema } from "@base-cafe/contracts";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { InventoryService } from "../src/inventory/inventory.service.js";

const branchId = "10000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000002";
const userId = "10000000-0000-4000-8000-000000000003";
const deviceId = "10000000-0000-4000-8000-000000000004";
const locationId = "10000000-0000-4000-8000-000000000005";
const itemId = "10000000-0000-4000-8000-000000000006";
const entryId = "10000000-0000-4000-8000-000000000007";
const menuItemId = "10000000-0000-4000-8000-000000000008";

const principal = (permissions: readonly string[]): AuthPrincipal => ({
  userId,
  organizationId,
  deviceId,
  displayName: "Inventory user",
  email: "inventory@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});

describe("inventory service", () => {
  it("returns a visible configuration issue instead of inventing a recipe", async () => {
    const prisma = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      recipeVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    await expect(
      new InventoryService(prisma).consumptionPreview(
        {
          branchId,
          menuItemId,
          quantity: 1,
        },
        principal(["inventory.read"]),
      ),
    ).resolves.toEqual({
      configured: false,
      code: "RECIPE_CONFIGURATION_MISSING",
      automaticDeductionEnabled: false,
    });
  });

  it("blocks negative stock until a manager explicitly overrides it", async () => {
    const transaction = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      stockLocation: {
        findFirst: vi.fn().mockResolvedValue({ id: locationId }),
      },
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: itemId }) },
      stockLedgerEntry: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { quantityDeltaMicros: 0n } }),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;
    await expect(
      new InventoryService(prisma).postAdjustment(
        {
          ledgerEntryId: entryId,
          branchId,
          locationId,
          inventoryItemId: itemId,
          type: "WASTE",
          quantityDeltaMicros: "-1",
          allowNegativeOverride: false,
          reason: "Damaged stock",
        },
        "inventory-negative-key",
        principal(["inventory.write"]),
      ),
    ).rejects.toMatchObject({
      response: { code: "NEGATIVE_STOCK_POLICY_UNCONFIRMED" },
    });
  });

  it("posts an exact opening balance with audit and outbox records", async () => {
    const entry = {
      id: entryId,
      branchId,
      locationId,
      inventoryItemId: itemId,
      type: "OPENING_BALANCE",
      quantityDeltaMicros: 5_000_000n,
      sourceType: "MANUAL_STOCK_COMMAND",
      sourceId: entryId,
      negativeStockOverride: false,
      reason: "Verified opening stock",
      occurredAt: new Date("2026-08-09T12:00:00.000Z"),
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
      location: { id: locationId, name: "Fictional store" },
      inventoryItem: {
        id: itemId,
        name: "Fictional ingredient",
        baseUnit: {
          id: "10000000-0000-4000-8000-000000000009",
          code: "EA",
          name: "Each",
          dimension: "COUNT",
          isActive: true,
          revision: 1,
        },
      },
      actor: { displayName: "Inventory user" },
    };
    const transaction = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      stockLocation: {
        findFirst: vi.fn().mockResolvedValue({ id: locationId }),
      },
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: itemId }) },
      stockLedgerEntry: { create: vi.fn().mockResolvedValue(entry) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;
    await expect(
      new InventoryService(prisma).postAdjustment(
        {
          ledgerEntryId: entryId,
          branchId,
          locationId,
          inventoryItemId: itemId,
          type: "OPENING_BALANCE",
          quantityDeltaMicros: "5000000",
          allowNegativeOverride: false,
          reason: "Verified opening stock",
        },
        "inventory-opening-key",
        principal(["inventory.write"]),
      ),
    ).resolves.toMatchObject({
      id: entryId,
      quantityDeltaMicros: "5000000",
      actorDisplayName: "Inventory user",
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "inventory.ledger.posted" }),
    });
  });

  it("enforces branch permissions before inventory reads", async () => {
    const prisma = {} as PrismaService;
    await expect(
      new InventoryService(prisma).balances(branchId, principal([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("projects ledger attribution without actor or device identifiers", async () => {
    const projected = {
      id: entryId,
      branchId,
      locationId,
      inventoryItemId: itemId,
      type: "OPENING_BALANCE",
      quantityDeltaMicros: 1_000_000n,
      sourceType: "MANUAL_STOCK_COMMAND",
      sourceId: entryId,
      negativeStockOverride: false,
      reason: "Fictional opening balance",
      occurredAt: new Date("2026-08-09T12:00:00.000Z"),
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
      location: { id: locationId, name: "Fictional store" },
      inventoryItem: {
        id: itemId,
        name: "Fictional item",
        baseUnit: {
          id: "10000000-0000-4000-8000-000000000009",
          code: "EA",
          name: "Each",
          dimension: "COUNT",
          isActive: true,
          revision: 1,
        },
      },
      actor: { displayName: "Inventory user" },
    };
    const database = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      stockLedgerEntry: { findMany: vi.fn().mockResolvedValue([projected]) },
    } as unknown as PrismaService;
    const response = await new InventoryService(database).listLedger(
      branchId,
      { limit: 100 },
      principal(["inventory.read"]),
    );
    const parsed = stockLedgerListResponseSchema.parse(response);
    const visible = response as Array<Record<string, unknown>>;
    expect(parsed[0]?.actorDisplayName).toBe("Inventory user");
    expect(visible[0]).not.toHaveProperty("actor");
    expect(visible[0]).not.toHaveProperty("deviceId");
  });

  it("requires inventory.manage for a negative override", async () => {
    const transaction = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      stockLocation: {
        findFirst: vi.fn().mockResolvedValue({ id: locationId }),
      },
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: itemId }) },
      stockLedgerEntry: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { quantityDeltaMicros: 0n } }),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;
    await expect(
      new InventoryService(prisma).postAdjustment(
        {
          ledgerEntryId: entryId,
          branchId,
          locationId,
          inventoryItemId: itemId,
          type: "WASTE",
          quantityDeltaMicros: "-1",
          allowNegativeOverride: true,
          reason: "Damaged stock",
        },
        "inventory-override-key",
        principal(["inventory.write"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("selects recipe projections without configuration actor identifiers", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: branchId, organizationId }),
      },
      recipeVersion: { findMany },
    } as unknown as PrismaService;
    await new InventoryService(database).listRecipes(
      branchId,
      { limit: 200, includeInactive: true },
      principal(["inventory.read"]),
    );
    const selection = findMany.mock.calls[0]?.[0]?.select;
    expect(selection).toBeDefined();
    expect(selection).not.toHaveProperty("createdById");
    expect(selection).not.toHaveProperty("activatedById");
  });
});
