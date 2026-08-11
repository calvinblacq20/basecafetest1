import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { KdsService } from "../src/kds/kds.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const ticketId = "10000000-0000-4000-8000-000000000005";

function principal(permissions: readonly string[]): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId,
    displayName: "Kitchen user",
    email: "kitchen@example.test",
    mustChangePassword: false,
    assignments: [{ scope: "BRANCH", branchId, permissions }],
  };
}

describe("KDS service", () => {
  it("lists only active stations inside the authenticated tenant", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000006",
        name: "Kitchen",
        kind: "KITCHEN",
      },
    ]);
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      station: { findMany },
    } as unknown as PrismaService;
    await expect(
      new KdsService(prisma).stations(branchId, principal(["kds.read"])),
    ).resolves.toEqual([
      expect.objectContaining({ name: "Kitchen", kind: "KITCHEN" }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId, isActive: true },
      }),
    );
  });

  it("denies state changes before persistence", async () => {
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    await expect(
      new KdsService(prisma).preparing(
        ticketId,
        { branchId, revision: 1, reason: "Start prep" },
        "kds-preparing-key-0001",
        principal([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("atomically starts a queued ticket with event, audit, and outbox", async () => {
    const queued = {
      id: ticketId,
      branchId,
      stationId: "10000000-0000-4000-8000-000000000006",
      status: "QUEUED",
      revision: 1,
      entries: [],
      events: [],
    };
    const preparing = { ...queued, status: "PREPARING", revision: 2 };
    const client = {
      preparationTicket: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(queued)
          .mockResolvedValueOnce(preparing),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      preparationTicketEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;

    await expect(
      new KdsService(prisma).preparing(
        ticketId,
        { branchId, revision: 1, reason: "Start prep" },
        "kds-preparing-key-0002",
        principal(["kds.write"]),
      ),
    ).resolves.toEqual(preparing);
    expect(client.preparationTicketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId,
        fromStatus: "QUEUED",
        toStatus: "PREPARING",
        revision: 2,
      }),
    });
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(client.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(client.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  });

  it("dispatches prepared inventory when the final required ticket becomes ready", async () => {
    const lineId = "10000000-0000-4000-8000-000000000007";
    const stationId = "10000000-0000-4000-8000-000000000006";
    const occurredAt = new Date("2026-08-07T12:00:00.000Z");
    const preparing = {
      id: ticketId,
      branchId,
      stationId,
      status: "PREPARING",
      revision: 2,
      entries: [{ orderLineId: lineId, cancelledAt: null }],
      events: [],
    };
    const ready = { ...preparing, status: "READY", revision: 3 };
    const client = {
      preparationTicket: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(preparing)
          .mockResolvedValueOnce(ready),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      preparationTicketEvent: {
        create: vi.fn().mockResolvedValue({
          id: "10000000-0000-4000-8000-000000000008",
          occurredAt,
        }),
      },
      preparationTicketEntry: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { orderLineId: lineId, ticket: { status: "READY" } },
          ]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;
    const postAutomatically = vi
      .fn()
      .mockResolvedValue({ enabled: true, postedConsumptionIds: [lineId] });

    const result = await new KdsService(prisma, {
      postAutomatically,
    } as never).ready(
      ticketId,
      { branchId, revision: 2, reason: "Finish preparation" },
      "kds-ready-key-automatic-0001",
      principal(["kds.write"]),
    );

    expect(result).toMatchObject({
      status: "READY",
      inventory: { enabled: true, postedConsumptionIds: [lineId] },
    });
    expect(postAutomatically).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        branchId,
        orderLineIds: [lineId],
        trigger: "PREPARED",
        occurredAt,
      }),
      expect.objectContaining({ userId }),
    );
  });

  it("rejects skipped ticket states with a stable code", async () => {
    const client = {
      preparationTicket: {
        findFirst: vi.fn().mockResolvedValue({
          id: ticketId,
          branchId,
          stationId: "10000000-0000-4000-8000-000000000006",
          status: "QUEUED",
          revision: 1,
          entries: [],
          events: [],
        }),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (transaction: object) => unknown) =>
        work(client),
      ),
    } as unknown as PrismaService;
    const error = await new KdsService(prisma)
      .ready(
        ticketId,
        { branchId, revision: 1, reason: "Skip start" },
        "kds-ready-key-0001",
        principal(["kds.write"]),
      )
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "TICKET_STATE_INVALID",
    });
  });
});
