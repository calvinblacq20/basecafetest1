import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

export const AUDIT_INTEGRITY_GENESIS_HASH = "0".repeat(64);

export type IntegrityAuditEvent = Readonly<{
  id: string;
  organizationId: string;
  branchId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  reason: string | null;
  metadata: Prisma.JsonValue | null;
  occurredAt: Date;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  return value;
}

function framed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.map(framed).join(""), "utf8")
    .digest("hex");
}

export function hashAuditEvent(event: IntegrityAuditEvent): string {
  return digest([
    "BASE_CAFE_AUDIT_EVENT_V1",
    event.id,
    event.organizationId,
    event.branchId ?? "",
    event.actorId ?? "",
    event.action,
    event.entityType,
    event.entityId ?? "",
    event.outcome,
    event.reason ?? "",
    JSON.stringify(canonicalize(event.metadata)),
    event.occurredAt.toISOString(),
  ]);
}

export function hashAuditBatch(input: {
  organizationId: string;
  sequence: number;
  previousHash: string;
  events: readonly IntegrityAuditEvent[];
}): string {
  return digest([
    "BASE_CAFE_AUDIT_BATCH_V1",
    input.organizationId,
    String(input.sequence),
    input.previousHash,
    String(input.events.length),
    ...input.events.map(hashAuditEvent),
  ]);
}
