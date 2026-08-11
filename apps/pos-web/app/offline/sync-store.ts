import type {
  SyncBatchResponse,
  SyncCommand,
  SyncCommandResult,
} from "@base-cafe/contracts";

export type LocalCommandState =
  "PENDING" | "SENDING" | "SYNCED" | "CONFLICT" | "FAILED" | "RESOLVED";

export type LocalSyncCommand = SyncCommand & {
  state: LocalCommandState;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type NewSyncCommand = SyncCommand extends infer Command
  ? Command extends SyncCommand
    ? Omit<Command, "localSequence">
    : never
  : never;

export type LocalSyncSummary = {
  pending: number;
  sending: number;
  synced: number;
  conflicts: number;
  failed: number;
  resolved: number;
  lastSuccessfulSyncAt: string | null;
};

export interface SyncStore {
  enqueue(command: NewSyncCommand): Promise<LocalSyncCommand>;
  ready(now: Date, limit: number): Promise<LocalSyncCommand[]>;
  markSending(commandIds: readonly string[]): Promise<void>;
  applyResults(
    response: SyncBatchResponse,
    backoff: (attempts: number) => number,
  ): Promise<void>;
  markTransportFailure(
    commandIds: readonly string[],
    code: string,
    backoff: (attempts: number) => number,
  ): Promise<void>;
  recoverInterrupted(): Promise<void>;
  retry(commandId: string): Promise<boolean>;
  resolve(commandId: string): Promise<boolean>;
  summary(): Promise<LocalSyncSummary>;
  list(): Promise<LocalSyncCommand[]>;
}

function stateFor(result: SyncCommandResult): LocalCommandState {
  if (result.status === "APPLIED" || result.status === "REPLAYED")
    return "SYNCED";
  if (result.status === "CONFLICT") return "CONFLICT";
  if (result.status === "REJECTED") return "FAILED";
  return "PENDING";
}

export function applyResult(
  command: LocalSyncCommand,
  result: SyncCommandResult,
  now: Date,
  backoff: (attempts: number) => number,
): LocalSyncCommand {
  const attempts = command.attempts + 1;
  const state = stateFor(result);
  return {
    ...command,
    state,
    attempts,
    lastErrorCode:
      state === "SYNCED" ? null : result.code || "SYNC_COMMAND_FAILED",
    nextAttemptAt:
      state === "PENDING"
        ? new Date(now.getTime() + backoff(attempts)).toISOString()
        : command.nextAttemptAt,
    updatedAt: now.toISOString(),
  };
}

export class MemorySyncStore implements SyncStore {
  private readonly commands = new Map<string, LocalSyncCommand>();
  private sequence = 0;
  private lastSuccessfulSyncAt: string | null = null;

  async enqueue(command: NewSyncCommand) {
    this.sequence += 1;
    const now = new Date().toISOString();
    const record = {
      ...command,
      localSequence: this.sequence,
      state: "PENDING" as const,
      attempts: 0,
      nextAttemptAt: now,
      lastErrorCode: null,
      updatedAt: now,
    } as LocalSyncCommand;
    this.commands.set(record.commandId, record);
    return record;
  }

  async ready(now: Date, limit: number) {
    const commands = [...this.commands.values()];
    const blockedAggregates = new Set(
      commands
        .filter((command) => ["CONFLICT", "FAILED"].includes(command.state))
        .map((command) => command.aggregateId),
    );
    const pending = commands
      .filter((command) => command.state === "PENDING")
      .sort((left, right) => left.localSequence - right.localSequence);
    const ready: LocalSyncCommand[] = [];
    for (const command of pending) {
      if (new Date(command.nextAttemptAt).getTime() > now.getTime()) break;
      if (blockedAggregates.has(command.aggregateId)) continue;
      ready.push(command);
      if (ready.length === limit) break;
    }
    return ready;
  }

  async markSending(commandIds: readonly string[]) {
    const now = new Date().toISOString();
    for (const commandId of commandIds) {
      const command = this.commands.get(commandId);
      if (command)
        this.commands.set(commandId, {
          ...command,
          state: "SENDING",
          updatedAt: now,
        });
    }
  }

  async applyResults(
    response: SyncBatchResponse,
    backoff: (attempts: number) => number,
  ) {
    const now = new Date(response.generatedAt);
    for (const result of response.results) {
      const command = this.commands.get(result.commandId);
      if (command)
        this.commands.set(
          result.commandId,
          applyResult(command, result, now, backoff),
        );
    }
    this.lastSuccessfulSyncAt = response.generatedAt;
  }

  async markTransportFailure(
    commandIds: readonly string[],
    code: string,
    backoff: (attempts: number) => number,
  ) {
    const now = new Date();
    for (const commandId of commandIds) {
      const command = this.commands.get(commandId);
      if (!command) continue;
      const attempts = command.attempts + 1;
      this.commands.set(commandId, {
        ...command,
        state: "PENDING",
        attempts,
        lastErrorCode: code,
        nextAttemptAt: new Date(
          now.getTime() + backoff(attempts),
        ).toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }

  async recoverInterrupted() {
    const now = new Date().toISOString();
    for (const [id, command] of this.commands) {
      if (command.state === "SENDING")
        this.commands.set(id, {
          ...command,
          state: "PENDING",
          nextAttemptAt: now,
          lastErrorCode: "SYNC_INTERRUPTED",
          updatedAt: now,
        });
    }
  }

  async retry(commandId: string) {
    const command = this.commands.get(commandId);
    if (!command || command.state !== "PENDING") return false;
    const now = new Date().toISOString();
    this.commands.set(commandId, {
      ...command,
      state: "PENDING",
      attempts: 0,
      nextAttemptAt: now,
      lastErrorCode: "MANUAL_RETRY_REQUESTED",
      updatedAt: now,
    });
    return true;
  }

  async resolve(commandId: string) {
    const command = this.commands.get(commandId);
    if (!command || !["CONFLICT", "FAILED"].includes(command.state))
      return false;
    this.commands.set(commandId, {
      ...command,
      state: "RESOLVED",
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async summary() {
    const counts = {
      pending: 0,
      sending: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      resolved: 0,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
    };
    for (const command of this.commands.values()) {
      if (command.state === "PENDING") counts.pending += 1;
      if (command.state === "SENDING") counts.sending += 1;
      if (command.state === "SYNCED") counts.synced += 1;
      if (command.state === "CONFLICT") counts.conflicts += 1;
      if (command.state === "FAILED") counts.failed += 1;
      if (command.state === "RESOLVED") counts.resolved += 1;
    }
    return counts;
  }

  async list() {
    return [...this.commands.values()].sort(
      (left, right) => left.localSequence - right.localSequence,
    );
  }
}
