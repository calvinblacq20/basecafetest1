import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { InventoryConsumptionService } from "../src/inventory-consumption/inventory-consumption.service.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);
const principal = (permissions: readonly string[]): AuthPrincipal => ({
  userId: id(2),
  organizationId: id(3),
  deviceId: id(4),
  displayName: "Inventory lead",
  email: "inventory@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});
const sentAt = new Date("2026-08-07T12:00:00.000Z");

const previewPrisma = (overrides: Record<string, unknown> = {}) =>
  ({
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
        sentAt,
        sentCancelledAt: null,
        order: { id: id(6), branchId },
        modifiers: [],
      }),
    },
    inventoryDeductionPolicyVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: id(10), trigger: "SENT" }),
    },
    recipeVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: id(11),
        version: 3,
        yieldQuantityMicros: 1_000_000n,
        components: [
          {
            inventoryItemId: id(12),
            quantityMicros: 250_000n,
            inventoryItem: { id: id(12), name: "Coffee beans", isActive: true },
          },
        ],
      }),
    },
    inventoryConsumptionRouteVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: id(13),
          stationId: id(8),
          locationId: id(14),
          location: { id: id(14), name: "Bar store", isActive: true },
        },
      ]),
    },
    modifierRecipeEffectVersion: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  }) as unknown as PrismaService;

describe("inventory consumption service", () => {
  it("resolves exact micro quantities and station-specific routes", async () => {
    const result = await new InventoryConsumptionService(
      previewPrisma(),
    ).preview(
      {
        branchId,
        orderLineId: id(5),
        sourceEventId: id(9),
        trigger: "SENT",
      },
      principal(["inventory.read"]),
    );
    expect(result).toMatchObject({
      configured: true,
      policyVersionId: id(10),
      recipeVersionId: id(11),
      entries: [
        {
          routeVersionId: id(13),
          locationId: id(14),
          quantityMicros: "500000",
        },
      ],
    });
  });

  it("blocks posting when no confirmed active deduction policy exists", async () => {
    const prisma = previewPrisma({
      inventoryDeductionPolicyVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    await expect(
      new InventoryConsumptionService(prisma).preview(
        {
          branchId,
          orderLineId: id(5),
          sourceEventId: id(9),
          trigger: "SENT",
        },
        principal(["inventory.read"]),
      ),
    ).rejects.toMatchObject({
      response: { code: "INVENTORY_DEDUCTION_POLICY_MISSING" },
    });
  });

  it("refuses to assume whether modifiers affect inventory", async () => {
    const prisma = previewPrisma();
    vi.mocked(prisma.orderLine.findFirst).mockResolvedValueOnce({
      id: id(5),
      orderId: id(6),
      menuItemId: id(7),
      variantId: null,
      stationId: id(8),
      quantity: 1,
      sendWaveId: id(9),
      sentAt,
      sentCancelledAt: null,
      order: { id: id(6), branchId },
      modifiers: [{ id: id(15) }],
    } as never);
    await expect(
      new InventoryConsumptionService(prisma).preview(
        {
          branchId,
          orderLineId: id(5),
          sourceEventId: id(9),
          trigger: "SENT",
        },
        principal(["inventory.read"]),
      ),
    ).rejects.toMatchObject({
      response: { code: "MODIFIER_INVENTORY_POLICY_UNCONFIRMED" },
    });
  });

  it("rejects quantities that cannot be represented as exact micro-units", async () => {
    const prisma = previewPrisma();
    vi.mocked(prisma.recipeVersion.findFirst).mockResolvedValueOnce({
      id: id(11),
      version: 3,
      yieldQuantityMicros: 3_000_000n,
      components: [
        {
          inventoryItemId: id(12),
          quantityMicros: 1n,
          inventoryItem: { id: id(12), name: "Spice", isActive: true },
        },
      ],
    } as never);
    await expect(
      new InventoryConsumptionService(prisma).preview(
        {
          branchId,
          orderLineId: id(5),
          sourceEventId: id(9),
          trigger: "SENT",
        },
        principal(["inventory.read"]),
      ),
    ).rejects.toMatchObject({
      response: { code: "INVENTORY_CONSUMPTION_FRACTIONAL_MICRO" },
    });
  });

  it("posts one exact negative ledger movement with audit and outbox evidence", async () => {
    const base = previewPrisma() as unknown as Record<string, unknown>;
    const tx = {
      ...base,
      stockLedgerEntry: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { quantityDeltaMicros: 1_000_000n },
        }),
        create: vi.fn().mockResolvedValue({}),
      },
      inventoryConsumption: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: id(16),
          entries: [{ quantityMicros: 500_000n }],
        }),
      },
      inventoryConsumptionEntry: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) => work(tx)),
    } as unknown as PrismaService;
    await expect(
      new InventoryConsumptionService(prisma).post(
        {
          consumptionId: id(16),
          branchId,
          orderLineId: id(5),
          sourceEventId: id(9),
          trigger: "SENT",
          ledgerEntries: [
            {
              inventoryItemId: id(12),
              locationId: id(14),
              ledgerEntryId: id(17),
            },
          ],
          allowNegativeOverride: false,
          reason: "Post sent line ingredients",
        },
        "inventory-consumption-post-key",
        principal(["inventory.write"]),
      ),
    ).resolves.toMatchObject({ id: id(16) });
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: id(17),
        type: "SALE_CONSUMPTION",
        quantityDeltaMicros: -500_000n,
        sourceType: "INVENTORY_CONSUMPTION",
        sourceId: id(16),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it("replays a stored command response without posting twice", async () => {
    const transaction = vi.fn();
    const prisma = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash:
            "405dd82a0f09997759f93e30fe6f25be26ab38e07db9a0d69c3d420eef8b1c7f",
          responseBody: { id: id(16), replayed: true },
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const command = {
      consumptionId: id(16),
      branchId,
      orderLineId: id(5),
      sourceEventId: id(9),
      trigger: "SENT" as const,
      ledgerEntries: [
        { inventoryItemId: id(12), locationId: id(14), ledgerEntryId: id(17) },
      ],
      allowNegativeOverride: false,
      reason: "Post sent line ingredients",
    };
    // Use the actual request hash so this proves replay, not conflict handling.
    const { requestHash } = await import("../src/common/request-hash.js");
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValueOnce({
      requestHash: requestHash(command),
      responseBody: { id: id(16), replayed: true },
    } as never);
    await expect(
      new InventoryConsumptionService(prisma).post(
        command,
        "same-key",
        principal(["inventory.write"]),
      ),
    ).resolves.toEqual({ id: id(16), replayed: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reverses every posted ingredient with an equal positive ledger entry", async () => {
    const tx = {
      branch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: branchId, organizationId: id(3) }),
      },
      inventoryConsumption: {
        findFirst: vi.fn().mockResolvedValue({
          id: id(16),
          branchId,
          revision: 1,
          reversal: null,
          entries: [
            {
              id: id(18),
              inventoryItemId: id(12),
              locationId: id(14),
              quantityMicros: 500_000n,
            },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inventoryConsumptionReversal: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: id(19),
          entries: [{ consumptionEntryId: id(18) }],
        }),
      },
      stockLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
      inventoryConsumptionReversalEntry: {
        create: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) => work(tx)),
    } as unknown as PrismaService;
    await expect(
      new InventoryConsumptionService(prisma).reverse(
        id(16),
        {
          reversalId: id(19),
          branchId,
          consumptionRevision: 1,
          ledgerEntries: [
            { consumptionEntryId: id(18), ledgerEntryId: id(20) },
          ],
          reason: "Reverse cancelled sent line",
        },
        "inventory-consumption-reverse-key",
        principal(["inventory.manage"]),
      ),
    ).resolves.toMatchObject({ id: id(19) });
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: id(20),
        type: "REVERSAL",
        quantityDeltaMicros: 500_000n,
        sourceType: "INVENTORY_CONSUMPTION_REVERSAL",
        sourceId: id(19),
      }),
    });
    expect(tx.inventoryConsumption.update).toHaveBeenCalledWith({
      where: { id: id(16) },
      data: { revision: { increment: 1 } },
    });
  });

  it("enforces branch permissions before reads", async () => {
    await expect(
      new InventoryConsumptionService({} as PrismaService).listPolicies(
        branchId,
        principal([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
