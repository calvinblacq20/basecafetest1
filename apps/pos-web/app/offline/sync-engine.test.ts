import type { SyncBatchResponse } from "@base-cafe/contracts";
import { describe, expect, it, vi } from "vitest";

import { SyncEngine } from "./sync-engine";
import { MemorySyncStore, type NewSyncCommand } from "./sync-store";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

function command(suffix: number): NewSyncCommand {
  return {
    commandId: id(suffix),
    branchId: id(100),
    deviceId: id(101),
    actorId: id(102),
    aggregateId: id(200),
    createdAt: "2026-08-07T12:00:00.000Z",
    schemaVersion: 1,
    idempotencyKey: `offline-command-${suffix.toString().padStart(4, "0")}`,
    commandType: "ORDER_HOLD",
    payload: { branchId: id(100), revision: suffix, reason: "Offline hold" },
  };
}

const response = (
  results: SyncBatchResponse["results"],
): SyncBatchResponse => ({
  generatedAt: "2026-08-07T12:01:00.000Z",
  results,
});

describe("SyncEngine", () => {
  it("sends commands in device-local order and treats replay as synced", async () => {
    const store = new MemorySyncStore();
    const first = await store.enqueue(command(1));
    const second = await store.enqueue(command(2));
    const transport = vi.fn().mockResolvedValue(
      response(
        [first, second].map((item, index) => ({
          commandId: item.commandId,
          localSequence: item.localSequence,
          status: index ? "REPLAYED" : "APPLIED",
          retryable: false,
          code: index ? "COMMAND_REPLAYED" : "COMMAND_APPLIED",
          serverReceivedAt: "2026-08-07T12:01:00.000Z",
          clockSkewMs: 60_000,
          warnings: [],
        })),
      ),
    );
    const engine = new SyncEngine(
      store,
      transport,
      () => true,
      () => 0,
    );
    await engine.initialize();
    await engine.flush();
    expect(
      transport.mock.calls[0]?.[0].map(
        (item: { localSequence: number }) => item.localSequence,
      ),
    ).toEqual([1, 2]);
    expect((await store.summary()).synced).toBe(2);
  });

  it("preserves conflicts while allowing a partial batch to succeed", async () => {
    const store = new MemorySyncStore();
    const first = await store.enqueue(command(1));
    const second = await store.enqueue({ ...command(2), aggregateId: id(201) });
    const engine = new SyncEngine(
      store,
      async () =>
        response([
          {
            commandId: first.commandId,
            localSequence: first.localSequence,
            status: "CONFLICT",
            retryable: false,
            code: "STALE_REVISION",
            serverReceivedAt: "2026-08-07T12:01:00.000Z",
            clockSkewMs: 60_000,
            warnings: [],
          },
          {
            commandId: second.commandId,
            localSequence: second.localSequence,
            status: "APPLIED",
            retryable: false,
            code: "COMMAND_APPLIED",
            serverReceivedAt: "2026-08-07T12:01:00.000Z",
            clockSkewMs: 60_000,
            warnings: [],
          },
        ]),
      () => true,
      () => 0,
    );
    await engine.flush();
    expect(await store.summary()).toMatchObject({ conflicts: 1, synced: 1 });
  });

  it("returns transport failures to the pending queue with backoff", async () => {
    const store = new MemorySyncStore();
    await store.enqueue(command(1));
    const engine = new SyncEngine(
      store,
      async () => Promise.reject(new Error("offline")),
      () => true,
      () => 60_000,
    );
    await engine.flush();
    const [record] = await store.list();
    expect(record).toMatchObject({
      state: "PENDING",
      attempts: 1,
      lastErrorCode: "SYNC_TRANSPORT_UNAVAILABLE",
    });
  });

  it("recovers commands left sending by a browser crash", async () => {
    const store = new MemorySyncStore();
    const queued = await store.enqueue(command(1));
    await store.markSending([queued.commandId]);
    const engine = new SyncEngine(store, vi.fn(), () => false);
    await engine.initialize();
    expect((await store.list())[0]).toMatchObject({
      state: "PENDING",
      lastErrorCode: "SYNC_INTERRUPTED",
    });
    expect(engine.getSnapshot().connectivity).toBe("OFFLINE");
  });
  it("blocks later commands for a conflicted aggregate until manager resolution", async () => {
    const store = new MemorySyncStore();
    const conflicted = await store.enqueue(command(1));
    const dependent = await store.enqueue(command(2));
    const unrelated = await store.enqueue({
      ...command(3),
      aggregateId: id(201),
    });
    await store.applyResults(
      response([
        {
          commandId: conflicted.commandId,
          localSequence: conflicted.localSequence,
          status: "CONFLICT",
          retryable: false,
          code: "STALE_REVISION",
          serverReceivedAt: "2026-08-07T12:01:00.000Z",
          clockSkewMs: 60_000,
          warnings: [],
        },
      ]),
      () => 0,
    );

    expect(
      (await store.ready(new Date("2099-08-07T12:02:00.000Z"), 25)).map(
        ({ commandId }) => commandId,
      ),
    ).toEqual([unrelated.commandId]);

    const transport = vi.fn(async (commands: readonly unknown[]) => {
      const values = commands as Array<{
        commandId: string;
        localSequence: number;
      }>;
      return response(
        values.map((value) => ({
          commandId: value.commandId,
          localSequence: value.localSequence,
          status: "APPLIED" as const,
          retryable: false,
          code: "COMMAND_APPLIED",
          serverReceivedAt: "2026-08-07T12:03:00.000Z",
          clockSkewMs: 60_000,
          warnings: [],
        })),
      );
    });
    const recovery = vi.fn().mockResolvedValue(undefined);
    const engine = new SyncEngine(
      store,
      transport,
      () => true,
      () => 0,
      recovery,
    );
    await engine.resolveTerminal(conflicted.commandId, {
      action: "ACKNOWLEDGED_NO_ACTION",
      successorCommandId: null,
      reason: "Server state verified by manager.",
    });

    expect(recovery).toHaveBeenCalledOnce();
    expect(
      (await store.list()).find(
        ({ commandId }) => commandId === conflicted.commandId,
      )?.state,
    ).toBe("RESOLVED");
    expect(
      (await store.list()).find(
        ({ commandId }) => commandId === dependent.commandId,
      )?.state,
    ).toBe("SYNCED");
  });
});
