import type { SyncBatchRequest } from "@base-cafe/contracts";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { SyncService } from "../src/sync/sync.service.js";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const branchId = id(1);
const deviceId = id(2);
const actorId = id(3);
const organizationId = id(4);
const orderId = id(5);

const principal: AuthPrincipal = {
  userId: actorId,
  organizationId,
  deviceId,
  displayName: "Offline Cashier",
  email: "cashier@example.test",
  mustChangePassword: false,
  assignments: [],
};

function holdCommand(sequence = 1) {
  return {
    commandId: id(10 + sequence),
    branchId,
    deviceId,
    actorId,
    aggregateId: orderId,
    localSequence: sequence,
    createdAt: "2026-08-07T12:00:00.000Z",
    schemaVersion: 1 as const,
    idempotencyKey: `offline-hold-${sequence.toString().padStart(8, "0")}`,
    commandType: "ORDER_HOLD" as const,
    payload: { branchId, revision: sequence, reason: "Offline hold" },
  };
}

function setup(overrides?: {
  prior?: unknown;
  hold?: ReturnType<typeof vi.fn>;
}) {
  const create = vi.fn().mockResolvedValue({});
  const prisma = {
    device: { findFirst: vi.fn().mockResolvedValue({ id: deviceId }) },
    syncCommandReceipt: {
      findFirst: vi.fn().mockResolvedValue(overrides?.prior ?? null),
      create,
    },
  };
  const hold =
    overrides?.hold ??
    vi.fn().mockResolvedValue({ customerPhone: "not-stored" });
  const service = new SyncService(
    prisma as never,
    { hold } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, hold, create };
}

describe("SyncService", () => {
  it("applies an ordered domain command and stores only a safe receipt", async () => {
    const { service, hold, create } = setup();
    const result = await service.batch(
      { commands: [holdCommand()] } as SyncBatchRequest,
      principal,
    );
    expect(result.results[0]).toMatchObject({
      status: "APPLIED",
      code: "COMMAND_APPLIED",
      response: { customerPhone: "not-stored" },
    });
    expect(hold).toHaveBeenCalledWith(
      orderId,
      holdCommand().payload,
      holdCommand().idempotencyKey,
      principal,
    );
    expect(create.mock.calls[0]?.[0].data.resultBody).toEqual({
      code: "COMMAND_APPLIED",
      aggregateId: orderId,
    });
  });

  it("returns the prior terminal outcome for an exact replay", async () => {
    const command = holdCommand();
    const initial = setup();
    await initial.service.batch(
      { commands: [command] } as SyncBatchRequest,
      principal,
    );
    const receipt = initial.create.mock.calls[0]?.[0].data;
    const replay = setup({
      prior: { ...receipt, resultBody: receipt.resultBody },
    });
    const result = await replay.service.batch(
      { commands: [command] } as SyncBatchRequest,
      principal,
    );
    expect(result.results[0]).toMatchObject({ status: "REPLAYED" });
    expect(replay.hold).not.toHaveBeenCalled();
  });

  it("blocks later commands for the same aggregate after a conflict", async () => {
    const hold = vi
      .fn()
      .mockRejectedValue(new ConflictException({ code: "STALE_REVISION" }));
    const { service } = setup({ hold });
    const result = await service.batch(
      { commands: [holdCommand(1), holdCommand(2)] } as SyncBatchRequest,
      principal,
    );
    expect(result.results.map(({ status }) => status)).toEqual([
      "CONFLICT",
      "DEPENDENCY_BLOCKED",
    ]);
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged origin without creating a receipt", async () => {
    const { service, create } = setup();
    const result = await service.batch(
      {
        commands: [{ ...holdCommand(), actorId: id(99) }],
      } as SyncBatchRequest,
      principal,
    );
    expect(result.results[0]).toMatchObject({
      status: "REJECTED",
      code: "SYNC_ORIGIN_MISMATCH",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
