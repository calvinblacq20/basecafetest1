"use client";

import type { SyncRecoveryItem } from "@base-cafe/contracts";
import { Icon } from "@base-cafe/ui";
import { useCallback, useEffect, useState } from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";
import type { LocalSyncCommand } from "./offline/sync-store";
import {
  acknowledgeServerCommand,
  listServerRecovery,
} from "./receipt-recovery-client";

type ResolutionTarget =
  | { source: "LOCAL"; command: LocalSyncCommand }
  | { source: "SERVER"; command: SyncRecoveryItem };

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "SYNC_RECOVERY_FAILED";
  const messages: Record<string, string> = {
    SYNC_RECOVERY_REQUIRES_CONNECTION:
      "Server recovery requires an online connection.",
    SYNC_COMMAND_ALREADY_RESOLVED:
      "This command was already resolved. The queues have been refreshed.",
    SYNC_RECOVERY_UNAVAILABLE:
      "Recovery transport is unavailable for this device session.",
  };
  return messages[code] ?? code.replaceAll("_", " ");
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function RecoveryWorkspace({ runtime }: { runtime: CashierRuntime }) {
  const [local, setLocal] = useState<LocalSyncCommand[]>([]);
  const [server, setServer] = useState<SyncRecoveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<ResolutionTarget | null>(null);
  const [reason, setReason] = useState("");
  const permissions = runtime.session.user.permissions;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const canReadServer = permissions.includes("sync.recovery.read");
  const canManage = permissions.includes("sync.recovery.manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [localCommands, serverResponse] = await Promise.all([
        runtime.engine.listCommands(),
        canReadServer
          ? listServerRecovery(runtime.session)
          : Promise.resolve({
              generatedAt: new Date().toISOString(),
              items: [],
            }),
      ]);
      setLocal([...localCommands].reverse());
      setServer(serverResponse.items);
      setNotice(null);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [canReadServer, runtime]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function syncNow() {
    setBusy(true);
    try {
      await runtime.engine.flush();
      await load();
      setNotice(
        "The device outbox and authoritative recovery queue are current.",
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function retry(command: LocalSyncCommand) {
    setBusy(true);
    try {
      const changed = await runtime.engine.retry(command.commandId);
      setNotice(
        changed
          ? "The pending command was retried without changing its command ID."
          : "Only pending transport failures can be manually retried.",
      );
      await load();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (!target || !reason.trim()) {
      setNotice("A manager reason is required.");
      return;
    }
    setBusy(true);
    try {
      if (target.source === "LOCAL")
        await runtime.engine.resolveTerminal(target.command.commandId, {
          action: "ACKNOWLEDGED_NO_ACTION",
          successorCommandId: null,
          reason: reason.trim(),
        });
      else
        await acknowledgeServerCommand(
          runtime.session,
          target.command.commandId,
          reason.trim(),
        );
      setTarget(null);
      setReason("");
      await load();
      setNotice(
        "Resolution appended. The original terminal command remains in immutable history.",
      );
    } catch (error) {
      setNotice(errorMessage(error));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const localAttention = local.filter((command) =>
    ["CONFLICT", "FAILED"].includes(command.state),
  ).length;
  const localQueued = local.filter((command) =>
    ["PENDING", "SENDING"].includes(command.state),
  ).length;

  return (
    <section
      className="recovery-workspace"
      aria-label="Synchronization recovery"
    >
      <header className="workspace-heading recovery-workspace__heading">
        <div>
          <span>Offline-safe command control</span>
          <h1>Sync recovery</h1>
          <p>
            Retry transport failures with the same command ID. Terminal
            conflicts require a reasoned manager resolution and are never
            silently replayed.
          </p>
        </div>
        <button
          className="button button--primary"
          disabled={busy || !online}
          onClick={() => void syncNow()}
          type="button"
        >
          <Icon name="wifi" size={18} />
          {busy ? "Working…" : "Sync & refresh"}
        </button>
      </header>

      {notice ? (
        <div className="workspace-notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="recovery-metrics" aria-label="Recovery summary">
        <div>
          <span>Local commands</span>
          <strong>{local.length}</strong>
        </div>
        <div>
          <span>Queued</span>
          <strong>{localQueued}</strong>
        </div>
        <div>
          <span>Local attention</span>
          <strong>{localAttention}</strong>
        </div>
        <div>
          <span>Server unresolved</span>
          <strong>{canReadServer ? server.length : "—"}</strong>
        </div>
      </div>

      <div className="recovery-grid">
        <section className="recovery-panel" aria-label="Local device outbox">
          <div className="recovery-panel__heading">
            <div>
              <span>This device</span>
              <h2>Durable outbox</h2>
            </div>
            <button
              className="link-button"
              disabled={loading}
              onClick={() => void load()}
              type="button"
            >
              Refresh
            </button>
          </div>
          {!local.length && !loading ? (
            <div className="workspace-empty">
              <Icon name="wifi" size={30} />
              <strong>No device commands</strong>
              <span>The durable outbox is empty for this cashier profile.</span>
            </div>
          ) : null}
          <div className="recovery-list">
            {local.slice(0, 100).map((command) => (
              <article className="recovery-command" key={command.commandId}>
                <div className="recovery-command__topline">
                  <strong>{label(command.commandType)}</strong>
                  <span data-state={command.state}>{command.state}</span>
                </div>
                <small>
                  Sequence {command.localSequence} · attempts {command.attempts}
                </small>
                <small>Updated {timestamp(command.updatedAt)}</small>
                {command.lastErrorCode ? (
                  <p>{label(command.lastErrorCode)}</p>
                ) : null}
                <div className="recovery-command__actions">
                  {command.state === "PENDING" ? (
                    <button
                      className="link-button"
                      disabled={busy || !online}
                      onClick={() => void retry(command)}
                      type="button"
                    >
                      Retry now
                    </button>
                  ) : null}
                  {["CONFLICT", "FAILED"].includes(command.state) &&
                  canManage ? (
                    <button
                      className="link-button"
                      disabled={busy || !online}
                      onClick={() => {
                        setTarget({ source: "LOCAL", command });
                        setReason("");
                      }}
                      type="button"
                    >
                      Review resolution
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="recovery-panel" aria-label="Server recovery queue">
          <div className="recovery-panel__heading">
            <div>
              <span>Authoritative ledger</span>
              <h2>Terminal commands</h2>
            </div>
          </div>
          {!canReadServer ? (
            <div className="workspace-empty">
              <Icon name="audit" size={30} />
              <strong>Permission required</strong>
              <span>sync.recovery.read is required for this branch queue.</span>
            </div>
          ) : null}
          {canReadServer && !server.length && !loading ? (
            <div className="workspace-empty">
              <Icon name="audit" size={30} />
              <strong>No unresolved commands</strong>
              <span>
                The server has no terminal sync receipts awaiting review.
              </span>
            </div>
          ) : null}
          <div className="recovery-list">
            {server.map((command) => (
              <article className="recovery-command" key={command.commandId}>
                <div className="recovery-command__topline">
                  <strong>{label(command.commandType)}</strong>
                  <span data-state={command.status}>{command.status}</span>
                </div>
                <small>Sequence {command.localSequence}</small>
                <small>Received {timestamp(command.receivedAt)}</small>
                <p>{label(command.errorCode ?? command.status)}</p>
                {canManage ? (
                  <button
                    className="link-button"
                    disabled={busy || !online}
                    onClick={() => {
                      setTarget({ source: "SERVER", command });
                      setReason("");
                    }}
                    type="button"
                  >
                    Acknowledge after review
                  </button>
                ) : (
                  <small>Manager permission is required to resolve.</small>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      {target ? (
        <div className="workspace-action-sheet" role="dialog" aria-modal="true">
          <div>
            <span>Append-only resolution</span>
            <h2>Acknowledge without server action</h2>
            <p>
              Confirm authoritative state before proceeding. This preserves the
              rejected intent, unblocks later local work, and records audit and
              outbox evidence.
            </p>
            <dl className="recovery-resolution-facts">
              <div>
                <dt>Command</dt>
                <dd>{label(target.command.commandType)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {target.source === "LOCAL"
                    ? target.command.state
                    : target.command.status}
                </dd>
              </div>
            </dl>
            <label>
              Manager reason
              <textarea
                autoFocus
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <div className="workspace-action-sheet__buttons">
              <button
                className="button button--outline"
                onClick={() => setTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={busy || !reason.trim()}
                onClick={() => void resolve()}
                type="button"
              >
                {busy ? "Recording…" : "Append resolution"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
