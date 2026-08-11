import { describe, expect, it } from "vitest";

import {
  AUDIT_INTEGRITY_GENESIS_HASH,
  hashAuditBatch,
  hashAuditEvent,
  type IntegrityAuditEvent,
} from "../src/audit/audit-integrity-hash.js";

const event: IntegrityAuditEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  branchId: null,
  actorId: "00000000-0000-4000-8000-000000000003",
  action: "orders.cancel",
  entityType: "order",
  entityId: "00000000-0000-4000-8000-000000000004",
  outcome: "SUCCEEDED",
  reason: "Customer request",
  metadata: { z: 2, nested: { beta: true, alpha: "first" }, a: 1 },
  occurredAt: new Date("2026-08-08T08:30:00.000Z"),
};

describe("audit integrity hashing", () => {
  it("canonicalizes metadata object keys", () => {
    const reordered = {
      ...event,
      metadata: { a: 1, nested: { alpha: "first", beta: true }, z: 2 },
    };
    expect(hashAuditEvent(reordered)).toBe(hashAuditEvent(event));
  });

  it("detects an altered sealed fixture", () => {
    const sealed = hashAuditBatch({
      organizationId: event.organizationId,
      sequence: 1,
      previousHash: AUDIT_INTEGRITY_GENESIS_HASH,
      events: [event],
    });
    const altered = hashAuditBatch({
      organizationId: event.organizationId,
      sequence: 1,
      previousHash: AUDIT_INTEGRITY_GENESIS_HASH,
      events: [{ ...event, reason: "Altered after sealing" }],
    });
    expect(sealed).toMatch(/^[a-f0-9]{64}$/);
    expect(altered).not.toBe(sealed);
  });
});
