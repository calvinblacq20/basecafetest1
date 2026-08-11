import type { SyncBatchResponse } from "@base-cafe/contracts";

import {
  applyResult,
  type LocalSyncCommand,
  type LocalSyncSummary,
  type NewSyncCommand,
  type SyncStore,
} from "./sync-store";

export type OfflineScope = {
  organizationId: string;
  branchId: string;
  deviceId: string;
  userId: string;
};
export type SnapshotKind = "catalog" | "order" | "shift" | "ticket";
export type CachedSnapshot<T = unknown> = {
  id: string;
  value: T;
  cachedAt: string;
  expiresAt: string;
};

const SNAPSHOT_STORES: Record<SnapshotKind, string> = {
  catalog: "catalog-cache",
  order: "order-cache",
  shift: "shift-cache",
  ticket: "ticket-cache",
};

type SyncMeta = {
  key: "sync";
  nextSequence: number;
  lastSuccessfulSyncAt: string | null;
};

const DATABASE_VERSION = 3;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function databaseName(scope: OfflineScope) {
  return [
    "base-cafe-pos-v1",
    scope.organizationId,
    scope.branchId,
    scope.deviceId,
    scope.userId,
  ].join(":");
}

export class IndexedDbSyncStore implements SyncStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly scope: OfflineScope) {}

  async enqueue(command: NewSyncCommand) {
    const database = await this.database();
    const transaction = database.transaction(["meta", "outbox"], "readwrite");
    const metaStore = transaction.objectStore("meta");
    const outbox = transaction.objectStore("outbox");
    const meta = ((await request(metaStore.get("sync"))) as
      SyncMeta | undefined) ?? {
      key: "sync",
      nextSequence: 1,
      lastSuccessfulSyncAt: null,
    };
    const now = new Date().toISOString();
    const record = {
      ...command,
      branchId: this.scope.branchId,
      deviceId: this.scope.deviceId,
      actorId: this.scope.userId,
      localSequence: meta.nextSequence,
      state: "PENDING" as const,
      attempts: 0,
      nextAttemptAt: now,
      lastErrorCode: null,
      updatedAt: now,
    } as LocalSyncCommand;
    outbox.add(record);
    metaStore.put({ ...meta, nextSequence: meta.nextSequence + 1 });
    await transactionDone(transaction);
    return record;
  }

  async ready(now: Date, limit: number) {
    const commands = await this.list();
    const blockedAggregates = new Set(
      commands
        .filter((command) => ["CONFLICT", "FAILED"].includes(command.state))
        .map((command) => command.aggregateId),
    );
    const ready: LocalSyncCommand[] = [];
    for (const command of commands.filter(
      (candidate) => candidate.state === "PENDING",
    )) {
      if (new Date(command.nextAttemptAt).getTime() > now.getTime()) break;
      if (blockedAggregates.has(command.aggregateId)) continue;
      ready.push(command);
      if (ready.length === limit) break;
    }
    return ready;
  }

  async markSending(commandIds: readonly string[]) {
    await this.update(commandIds, (command) => ({
      ...command,
      state: "SENDING",
      updatedAt: new Date().toISOString(),
    }));
  }

  async applyResults(
    response: SyncBatchResponse,
    backoff: (attempts: number) => number,
  ) {
    const byId = new Map(
      response.results.map((result) => [result.commandId, result]),
    );
    await this.update([...byId.keys()], (command) => {
      const result = byId.get(command.commandId);
      return result
        ? applyResult(command, result, new Date(response.generatedAt), backoff)
        : command;
    });
    await this.updateMeta((meta) => ({
      ...meta,
      lastSuccessfulSyncAt: response.generatedAt,
    }));
  }

  async markTransportFailure(
    commandIds: readonly string[],
    code: string,
    backoff: (attempts: number) => number,
  ) {
    const now = new Date();
    await this.update(commandIds, (command) => {
      const attempts = command.attempts + 1;
      return {
        ...command,
        state: "PENDING",
        attempts,
        lastErrorCode: code,
        nextAttemptAt: new Date(
          now.getTime() + backoff(attempts),
        ).toISOString(),
        updatedAt: now.toISOString(),
      };
    });
  }

  async recoverInterrupted() {
    const commands = (await this.list())
      .filter((command) => command.state === "SENDING")
      .map((command) => command.commandId);
    const now = new Date().toISOString();
    await this.update(commands, (command) => ({
      ...command,
      state: "PENDING",
      nextAttemptAt: now,
      lastErrorCode: "SYNC_INTERRUPTED",
      updatedAt: now,
    }));
  }

  async retry(commandId: string) {
    let changed = false;
    await this.update([commandId], (command) => {
      if (command.state !== "PENDING") return command;
      changed = true;
      const now = new Date().toISOString();
      return {
        ...command,
        state: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        lastErrorCode: "MANUAL_RETRY_REQUESTED",
        updatedAt: now,
      };
    });
    return changed;
  }

  async resolve(commandId: string) {
    let changed = false;
    await this.update([commandId], (command) => {
      if (!["CONFLICT", "FAILED"].includes(command.state)) return command;
      changed = true;
      return {
        ...command,
        state: "RESOLVED",
        lastErrorCode: null,
        updatedAt: new Date().toISOString(),
      };
    });
    return changed;
  }

  async summary(): Promise<LocalSyncSummary> {
    const [commands, meta] = await Promise.all([this.list(), this.meta()]);
    const summary: LocalSyncSummary = {
      pending: 0,
      sending: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      resolved: 0,
      lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
    };
    for (const command of commands) {
      if (command.state === "PENDING") summary.pending += 1;
      if (command.state === "SENDING") summary.sending += 1;
      if (command.state === "SYNCED") summary.synced += 1;
      if (command.state === "CONFLICT") summary.conflicts += 1;
      if (command.state === "FAILED") summary.failed += 1;
      if (command.state === "RESOLVED") summary.resolved += 1;
    }
    return summary;
  }

  async putSnapshot<T>(kind: SnapshotKind, snapshot: CachedSnapshot<T>) {
    const database = await this.database();
    const transaction = database.transaction(
      SNAPSHOT_STORES[kind],
      "readwrite",
    );
    transaction.objectStore(SNAPSHOT_STORES[kind]).put(snapshot);
    await transactionDone(transaction);
  }

  async getSnapshot<T>(kind: SnapshotKind, id: string) {
    const database = await this.database();
    const transaction = database.transaction(SNAPSHOT_STORES[kind], "readonly");
    const snapshot = (await request(
      transaction.objectStore(SNAPSHOT_STORES[kind]).get(id),
    )) as CachedSnapshot<T> | undefined;
    await transactionDone(transaction);
    return snapshot
      ? {
          snapshot,
          stale: new Date(snapshot.expiresAt).getTime() <= Date.now(),
        }
      : null;
  }

  async deleteSnapshot(kind: SnapshotKind, id: string) {
    const database = await this.database();
    const transaction = database.transaction(
      SNAPSHOT_STORES[kind],
      "readwrite",
    );
    transaction.objectStore(SNAPSHOT_STORES[kind]).delete(id);
    await transactionDone(transaction);
  }

  async list() {
    const database = await this.database();

    const transaction = database.transaction("outbox", "readonly");
    const records = (await request(
      transaction.objectStore("outbox").getAll(),
    )) as LocalSyncCommand[];
    await transactionDone(transaction);
    return records.sort(
      (left, right) => left.localSequence - right.localSequence,
    );
  }

  private async update(
    commandIds: readonly string[],
    transform: (command: LocalSyncCommand) => LocalSyncCommand,
  ) {
    if (!commandIds.length) return;
    const database = await this.database();
    const transaction = database.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    for (const commandId of commandIds) {
      const command = (await request(store.get(commandId))) as
        LocalSyncCommand | undefined;
      if (command) store.put(transform(command));
    }
    await transactionDone(transaction);
  }

  private async meta() {
    const database = await this.database();
    const transaction = database.transaction("meta", "readonly");
    const value = (await request(
      transaction.objectStore("meta").get("sync"),
    )) as SyncMeta | undefined;
    await transactionDone(transaction);
    return (
      value ?? { key: "sync", nextSequence: 1, lastSuccessfulSyncAt: null }
    );
  }

  private async updateMeta(transform: (meta: SyncMeta) => SyncMeta) {
    const database = await this.database();
    const transaction = database.transaction("meta", "readwrite");
    const store = transaction.objectStore("meta");
    const meta = ((await request(store.get("sync"))) as
      SyncMeta | undefined) ?? {
      key: "sync",
      nextSequence: 1,
      lastSuccessfulSyncAt: null,
    };
    store.put(transform(meta));
    await transactionDone(transaction);
  }

  private database() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(databaseName(this.scope), DATABASE_VERSION);
        open.onupgradeneeded = (event) => {
          const database = open.result;
          if (!database.objectStoreNames.contains("outbox")) {
            const outbox = database.createObjectStore("outbox", {
              keyPath: "commandId",
            });
            outbox.createIndex("localSequence", "localSequence", {
              unique: true,
            });
            outbox.createIndex("state", "state");
          }
          if (!database.objectStoreNames.contains("meta"))
            database.createObjectStore("meta", { keyPath: "key" });
          if (
            event.oldVersion < 3 &&
            database.objectStoreNames.contains("catalog-cache")
          )
            database.deleteObjectStore("catalog-cache");
          if (!database.objectStoreNames.contains("catalog-cache"))
            database.createObjectStore("catalog-cache", { keyPath: "id" });
          if (!database.objectStoreNames.contains("order-cache"))
            database.createObjectStore("order-cache", { keyPath: "id" });
          if (!database.objectStoreNames.contains("shift-cache"))
            database.createObjectStore("shift-cache", { keyPath: "id" });
          if (!database.objectStoreNames.contains("ticket-cache"))
            database.createObjectStore("ticket-cache", { keyPath: "id" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () =>
          reject(
            open.error ?? new Error("Unable to open the offline database"),
          );
        open.onblocked = () =>
          reject(new Error("OFFLINE_DATABASE_UPGRADE_BLOCKED"));
      });
    }
    return this.databasePromise;
  }
}
