import {
  syncBatchResponseSchema,
  type ResolveSyncCommandRequest,
  type SyncBatchResponse,
} from "@base-cafe/contracts";

import type {
  LocalSyncCommand,
  LocalSyncSummary,
  NewSyncCommand,
  SyncStore,
} from "./sync-store";

export type Connectivity = "ONLINE" | "OFFLINE" | "DEGRADED" | "SYNCING";
export type SyncSnapshot = LocalSyncSummary & { connectivity: Connectivity };
export type SyncTransport = (
  commands: readonly unknown[],
) => Promise<SyncBatchResponse>;
export type SyncRecoveryTransport = (
  command: LocalSyncCommand,
  resolution: Omit<ResolveSyncCommandRequest, "branchId">,
) => Promise<void>;

const EMPTY: SyncSnapshot = {
  connectivity: "ONLINE",
  pending: 0,
  sending: 0,
  synced: 0,
  conflicts: 0,
  failed: 0,
  resolved: 0,
  lastSuccessfulSyncAt: null,
};

export function boundedBackoff(attempts: number) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 5);
  const base = Math.min(30_000 * 2 ** exponent, 15 * 60_000);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return Math.min(base + jitter, 15 * 60_000);
}

export function createHttpSyncTransport(
  apiBaseUrl: string,
  getAccessToken: () => string | null,
): SyncTransport {
  return async (commands) => {
    const token = getAccessToken();
    if (!token) throw new Error("SYNC_AUTHENTICATION_REQUIRED");
    const response = await fetch(`${apiBaseUrl}/api/v1/sync/batch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ commands }),
    });
    if (!response.ok) throw new Error(`SYNC_HTTP_${response.status}`);
    return syncBatchResponseSchema.parse(await response.json());
  };
}

export function createHttpSyncRecoveryTransport(
  apiBaseUrl: string,
  getAccessToken: () => string | null,
): SyncRecoveryTransport {
  return async (command, resolution) => {
    const token = getAccessToken();
    if (!token) throw new Error("SYNC_AUTHENTICATION_REQUIRED");
    const response = await fetch(
      `${apiBaseUrl}/api/v1/sync/commands/${command.commandId}/resolve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": `sync-resolution:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ branchId: command.branchId, ...resolution }),
      },
    );
    if (!response.ok) throw new Error(`SYNC_RECOVERY_HTTP_${response.status}`);
  };
}

export class SyncEngine {
  private snapshot: SyncSnapshot = EMPTY;
  private readonly subscribers = new Set<() => void>();
  private activeFlush: Promise<void> | null = null;

  constructor(
    private readonly store: SyncStore,
    private readonly transport: SyncTransport,
    private readonly isOnline: () => boolean,
    private readonly backoff = boundedBackoff,
    private readonly recoveryTransport?: SyncRecoveryTransport,
  ) {}

  getSnapshot = () => this.snapshot;

  subscribe = (subscriber: () => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  async initialize() {
    await this.store.recoverInterrupted();
    await this.refresh(this.isOnline() ? "ONLINE" : "OFFLINE");
  }

  async enqueue(command: NewSyncCommand) {
    const record = await this.store.enqueue(command);
    await this.refresh(this.isOnline() ? "ONLINE" : "OFFLINE");
    return record;
  }

  flush() {
    if (!this.activeFlush) {
      this.activeFlush = this.runFlush().finally(() => {
        this.activeFlush = null;
      });
    }
    return this.activeFlush;
  }

  async retry(commandId: string) {
    const changed = await this.store.retry(commandId);
    if (changed) {
      await this.refresh(this.isOnline() ? "ONLINE" : "OFFLINE");
      await this.flush();
    }
    return changed;
  }

  async resolveTerminal(
    commandId: string,
    resolution: Omit<ResolveSyncCommandRequest, "branchId">,
  ) {
    if (!this.recoveryTransport) throw new Error("SYNC_RECOVERY_UNAVAILABLE");
    const command = (await this.store.list()).find(
      (candidate) => candidate.commandId === commandId,
    );
    if (!command || !["CONFLICT", "FAILED"].includes(command.state))
      throw new Error("SYNC_COMMAND_NOT_TERMINAL");
    await this.recoveryTransport(command, resolution);
    await this.store.resolve(commandId);
    await this.refresh(this.isOnline() ? "ONLINE" : "OFFLINE");
    await this.flush();
  }

  listCommands() {
    return this.store.list();
  }

  summary() {
    return this.store.summary();
  }

  async connectivityChanged(online: boolean) {
    if (!online) return this.refresh("OFFLINE");
    await this.refresh("ONLINE");
    await this.flush();
  }

  private async runFlush() {
    if (!this.isOnline()) return this.refresh("OFFLINE");
    while (this.isOnline()) {
      const commands = await this.store.ready(new Date(), 25);
      if (!commands.length) break;
      const commandIds = commands.map(({ commandId }) => commandId);
      await this.store.markSending(commandIds);
      await this.refresh("SYNCING");
      try {
        const response = await this.transport(commands);
        await this.store.applyResults(response, this.backoff);
        const returned = new Set(
          response.results.map(({ commandId }) => commandId),
        );
        const missing = commandIds.filter(
          (commandId) => !returned.has(commandId),
        );
        if (missing.length)
          await this.store.markTransportFailure(
            missing,
            "SYNC_RESULT_MISSING",
            this.backoff,
          );
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "SYNC_TRANSPORT_UNAVAILABLE";
        await this.store.markTransportFailure(commandIds, code, this.backoff);
        break;
      }
    }
    const summary = await this.store.summary();
    await this.refresh(
      summary.conflicts || summary.failed ? "DEGRADED" : "ONLINE",
    );
  }

  private async refresh(connectivity: Connectivity) {
    this.snapshot = { connectivity, ...(await this.store.summary()) };
    this.subscribers.forEach((subscriber) => subscriber());
  }
}
