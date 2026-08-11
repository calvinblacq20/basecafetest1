"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { LocalSyncCommand } from "./sync-store";
import { SyncEngine, type SyncSnapshot } from "./sync-engine";

const SERVER_SNAPSHOT: SyncSnapshot = {
  connectivity: "ONLINE",
  pending: 0,
  sending: 0,
  synced: 0,
  conflicts: 0,
  failed: 0,
  resolved: 0,
  lastSuccessfulSyncAt: null,
};

function label(snapshot: SyncSnapshot) {
  const outstanding = snapshot.pending + snapshot.sending;
  if (snapshot.connectivity === "OFFLINE")
    return `Offline · ${outstanding} queued`;
  if (snapshot.connectivity === "SYNCING")
    return `Syncing · ${outstanding} queued`;
  if (snapshot.connectivity === "DEGRADED")
    return `Needs attention · ${snapshot.conflicts + snapshot.failed}`;
  if (outstanding) return `Online · ${outstanding} queued`;
  return snapshot.lastSuccessfulSyncAt ? "Online · Synced" : "Online · Ready";
}

export function SyncIndicator({
  engine,
  canManage = false,
}: {
  engine: SyncEngine | null;
  canManage?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commands, setCommands] = useState<LocalSyncCommand[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? (() => () => undefined),
    engine?.getSnapshot ?? (() => SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT,
  );

  useEffect(() => {
    if (!engine) return;
    void engine.initialize().then(() => engine.flush());
    const online = () => void engine.connectivityChanged(true);
    const offline = () => void engine.connectivityChanged(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    const interval = window.setInterval(() => void engine.flush(), 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.clearInterval(interval);
    };
  }, [engine]);

  async function refreshCommands() {
    setCommands((await engine?.listCommands()) ?? []);
  }

  async function resolve(
    command: LocalSyncCommand,
    action: "ACKNOWLEDGED_NO_ACTION" | "SUPERSEDED_BY_COMMAND",
    successorCommandId?: string,
  ) {
    if (!reason.trim()) return setError("A manager reason is required.");
    setError(null);
    try {
      await engine?.resolveTerminal(command.commandId, {
        action,
        reason: reason.trim(),
        successorCommandId: successorCommandId ?? null,
      });
      setReviewing(null);
      setReason("");
      await refreshCommands();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Resolution failed",
      );
    }
  }

  const attention = commands.filter((command) =>
    ["CONFLICT", "FAILED"].includes(command.state),
  );

  return (
    <div className="sync-control">
      <button
        aria-expanded={expanded}
        className={`sync-state sync-state--${snapshot.connectivity.toLowerCase()}`}
        onClick={() => {
          setExpanded((value) => !value);
          if (!expanded) void refreshCommands();
        }}
        title="Open offline synchronization status"
        type="button"
      >
        <span className="sync-state__dot" />
        <span>{engine ? label(snapshot) : "Locked · Sign in required"}</span>
      </button>
      {expanded ? (
        <section className="sync-panel" aria-label="Synchronization status">
          <strong>Device synchronization</strong>
          <dl>
            <div>
              <dt>Queued</dt>
              <dd>{snapshot.pending + snapshot.sending}</dd>
            </div>
            <div>
              <dt>Conflicts</dt>
              <dd>{snapshot.conflicts}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{snapshot.failed}</dd>
            </div>
          </dl>
          <p>
            Last successful sync: {snapshot.lastSuccessfulSyncAt ?? "Not yet"}
          </p>
          {attention.length > 0 ? (
            <div className="sync-conflicts">
              {attention.slice(0, 5).map((command) => {
                const successor = commands.find(
                  (candidate) =>
                    candidate.aggregateId === command.aggregateId &&
                    candidate.localSequence > command.localSequence &&
                    candidate.state === "SYNCED",
                );
                return (
                  <article key={command.commandId}>
                    <strong>{command.commandType.replaceAll("_", " ")}</strong>
                    <span>{command.lastErrorCode ?? command.state}</span>
                    <small>Sequence {command.localSequence}</small>
                    {canManage && snapshot.connectivity !== "OFFLINE" ? (
                      reviewing === command.commandId ? (
                        <div className="sync-resolution-form">
                          <label>
                            Manager resolution reason
                            <textarea
                              maxLength={500}
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                              required
                              value={reason}
                            />
                          </label>
                          {error ? (
                            <small className="form-error">{error}</small>
                          ) : null}
                          {successor ? (
                            <button
                              onClick={() =>
                                void resolve(
                                  command,
                                  "SUPERSEDED_BY_COMMAND",
                                  successor.commandId,
                                )
                              }
                              type="button"
                            >
                              Superseded by sequence {successor.localSequence}
                            </button>
                          ) : null}
                          <button
                            onClick={() =>
                              void resolve(command, "ACKNOWLEDGED_NO_ACTION")
                            }
                            type="button"
                          >
                            Acknowledge no server action
                          </button>
                          <button
                            className="link-button"
                            onClick={() => setReviewing(null)}
                            type="button"
                          >
                            Cancel review
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setReviewing(command.commandId);
                            setReason("");
                            setError(null);
                          }}
                          type="button"
                        >
                          Review resolution
                        </button>
                      )
                    ) : (
                      <small>Online manager review required</small>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
          <button
            disabled={!engine || snapshot.connectivity === "SYNCING"}
            onClick={async () => {
              await engine?.flush();
              await refreshCommands();
            }}
            type="button"
          >
            {engine ? "Sync now" : "Sign in to activate this device"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
