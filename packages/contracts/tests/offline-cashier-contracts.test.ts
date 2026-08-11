import {
  loginResponseSchema,
  syncBootstrapResponseSchema,
  syncCommandSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const envelope = {
  commandId: id(1),
  branchId: id(2),
  deviceId: id(3),
  actorId: id(4),
  aggregateId: id(5),
  localSequence: 1,
  createdAt: "2026-08-07T12:00:00.000Z",
  schemaVersion: 1 as const,
  idempotencyKey: "offline:00000000-0000-4000-8000-000000000001",
};

describe("offline cashier contracts", () => {
  it.each([
    {
      commandType: "ORDER_LINE_REMOVE",
      targetLineId: id(6),
      payload: { branchId: id(2), orderRevision: 2, reason: "Remove draft" },
    },
    {
      commandType: "ORDER_COMPLETE",
      payload: { branchId: id(2), revision: 4, reason: "Complete paid order" },
    },
  ])("accepts $commandType", (command) => {
    expect(syncCommandSchema.parse({ ...envelope, ...command })).toMatchObject(
      command,
    );
  });

  it("returns the authenticated device scope needed for isolated storage", () => {
    expect(
      loginResponseSchema.parse({
        accessToken: "x".repeat(32),
        expiresAt: "2026-08-07T20:00:00.000Z",
        offlineAccess: {
          enabled: false,
          leaseExpiresAt: null,
          minimumPinLength: 6,
          maximumFailedAttempts: 5,
          lockoutSeconds: 300,
        },
        scope: {
          organizationId: id(7),
          branchId: id(2),
          deviceId: id(3),
        },
        user: {
          id: id(4),
          displayName: "Cashier",
          email: "cashier@example.test",
          permissions: ["orders.create"],
          mustChangePassword: false,
          mfaActive: false,
        },
      }).scope,
    ).toEqual({ organizationId: id(7), branchId: id(2), deviceId: id(3) });
  });

  it("validates a safe, PII-free bootstrap snapshot", () => {
    const parsed = syncBootstrapResponseSchema.parse({
      generatedAt: "2026-08-07T12:00:00.000Z",
      expiresAt: "2026-08-07T20:00:00.000Z",
      branch: {
        id: id(2),
        name: "Base Cafe",
        timezone: "Africa/Accra",
        currency: "GHS",
      },
      tables: [],
      shift: null,
      taxProfile: null,
      catalog: [],
      orders: [],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/phone|direction|password/i);
  });
});
