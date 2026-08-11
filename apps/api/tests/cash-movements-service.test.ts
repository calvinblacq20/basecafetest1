import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { CashMovementsService } from "../src/cash-movements/cash-movements.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";

const branchId = "10000000-0000-4000-8000-000000000001";
const requesterId = "10000000-0000-4000-8000-000000000002";
const movementId = "10000000-0000-4000-8000-000000000003";
const shiftId = "10000000-0000-4000-8000-000000000004";
const deviceId = "10000000-0000-4000-8000-000000000005";

const principal = (
  userId: string,
  permissions: readonly string[],
): AuthPrincipal => ({
  userId,
  organizationId: "10000000-0000-4000-8000-000000000006",
  deviceId,
  displayName: "Cashier",
  email: "cashier@example.test",
  mustChangePassword: false,
  assignments: [{ scope: "BRANCH", branchId, permissions }],
});

describe("cash movement service", () => {
  it("requests an approval-bound movement with audit and outbox evidence", async () => {
    const movement = {
      id: movementId,
      branchId,
      shiftId,
      requestedById: requesterId,
      requestedBy: { displayName: "Cashier" },
      type: "BANK_DROP",
      direction: "OUT",
      status: "AWAITING_APPROVAL",
      revision: 1,
      currency: "GHS",
      amountMinor: 25_000,
      reference: "DROP-001",
      evidenceNote: "Sealed bag logged",
      reason: "Reduce drawer exposure",
      postedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-08-09T10:00:00.000Z"),
      updatedAt: new Date("2026-08-09T10:00:00.000Z"),
      correctsMovement: null,
      approval: null,
    };
    const transaction = {
      staffShift: {
        findFirst: vi.fn().mockResolvedValue({
          id: shiftId,
          revision: 3,
          currency: "GHS",
        }),
      },
      cashMovement: {
        create: vi.fn().mockResolvedValue(movement),
        findUniqueOrThrow: vi.fn().mockResolvedValue(movement),
      },
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
      new CashMovementsService(prisma).request(
        {
          movementId,
          branchId,
          shiftId,
          shiftRevision: 3,
          type: "BANK_DROP",
          direction: "OUT",
          amountMinor: 25_000,
          reference: "DROP-001",
          evidenceNote: "Sealed bag logged",
          reason: "Reduce drawer exposure",
        },
        "cash-movement-request-key",
        principal(requesterId, ["cash-movements.request"]),
      ),
    ).resolves.toMatchObject({ id: movementId, status: "AWAITING_APPROVAL" });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "cash_movement.requested" }),
    });
  });

  it("prevents the requester from approving their own movement", async () => {
    const transaction = {
      cashMovement: {
        findFirst: vi.fn().mockResolvedValue({
          id: movementId,
          branchId,
          revision: 1,
          status: "AWAITING_APPROVAL",
          requestedById: requesterId,
          shift: { status: "OPEN" },
          approval: null,
        }),
      },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((work: (client: object) => unknown) =>
        work(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new CashMovementsService(prisma).approve(
        movementId,
        {
          approvalId: "10000000-0000-4000-8000-000000000007",
          branchId,
          revision: 1,
          decision: "APPROVE",
          evidenceNote: "Counted and checked",
          reason: "Manager review",
        },
        "cash-movement-approve-key",
        principal(requesterId, ["cash-movements.approve"]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
