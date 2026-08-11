import { describe, expect, it } from "vitest";

import { syncBatchRequestSchema, syncCommandSchema } from "../src/index.js";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const orderCommand = (sequence = 1) => ({
  commandId: id(1),
  branchId: id(2),
  deviceId: id(3),
  actorId: id(4),
  aggregateId: id(5),
  localSequence: sequence,
  createdAt: "2026-08-07T12:00:00.000Z",
  schemaVersion: 1 as const,
  idempotencyKey: "offline-command-0001",
  commandType: "ORDER_CREATE" as const,
  payload: {
    orderId: id(5),
    branchId: id(2),
    shiftId: id(6),
    clientReference: "LOCAL-1",
    channel: "DINE_IN" as const,
    allowTableConflict: false,
    reason: "Offline order capture",
  },
});

describe("sync contracts", () => {
  it("accepts a scoped versioned offline order command", () => {
    expect(syncCommandSchema.parse(orderCommand()).schemaVersion).toBe(1);
  });

  it("rejects aggregate and payload identity drift", () => {
    expect(
      syncCommandSchema.safeParse({ ...orderCommand(), aggregateId: id(9) })
        .success,
    ).toBe(false);
  });

  it("rejects unconfirmed offline electronic tenders", () => {
    const command = {
      ...orderCommand(),
      commandType: "CASH_PAYMENT_CREATE",
      payload: {
        paymentId: id(7),
        branchId: id(2),
        shiftId: id(6),
        method: "MANUAL_MOMO",
        amountMinor: 1000,
        externalReference: "MOMO-1",
        allocations: [
          { allocationId: id(8), orderId: id(5), amountMinor: 1000 },
        ],
        reason: "Offline payment",
      },
    };
    expect(syncCommandSchema.safeParse(command).success).toBe(false);
  });

  it("requires increasing device-local sequence order", () => {
    const second = { ...orderCommand(1), commandId: id(9) };
    expect(
      syncBatchRequestSchema.safeParse({ commands: [orderCommand(1), second] })
        .success,
    ).toBe(false);
  });
});
