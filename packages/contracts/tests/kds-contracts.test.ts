import { describe, expect, it } from "vitest";

import {
  kdsStationResponseSchema,
  preparationTicketResponseSchema,
  preparationTicketQuerySchema,
  sendOrderWaveRequestSchema,
  transitionPreparationTicketRequestSchema,
} from "../src/index.js";

const branchId = "10000000-0000-4000-8000-000000000001";
const lineId = "10000000-0000-4000-8000-000000000002";
const sendWaveId = "10000000-0000-4000-8000-000000000003";

describe("send wave and KDS contracts", () => {
  it("parses safe station and ticket response snapshots", () => {
    expect(
      kdsStationResponseSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Kitchen",
        kind: "KITCHEN",
      }).kind,
    ).toBe("KITCHEN");
    expect(
      preparationTicketResponseSchema.parse({
        id: "00000000-0000-4000-8000-000000000010",
        branchId: "00000000-0000-4000-8000-000000000001",
        stationId: "00000000-0000-4000-8000-000000000002",
        stationName: "Kitchen",
        orderId: "00000000-0000-4000-8000-000000000003",
        sendWaveId: "00000000-0000-4000-8000-000000000004",
        waveNumber: 1,
        status: "QUEUED",
        revision: 1,
        orderNumber: "20260809-0001",
        channel: "DINE_IN",
        serviceReference: "Table 1",
        cashierName: "Demo Cashier",
        businessDate: "2026-08-09",
        queuedAt: "2026-08-09T10:00:00.000Z",
        preparingAt: null,
        readyAt: null,
        completedAt: null,
        cancelledAt: null,
        entries: [],
      }).orderNumber,
    ).toBe("20260809-0001");
  });

  it("accepts client-generated wave and line IDs", () => {
    expect(
      sendOrderWaveRequestSchema.parse({
        branchId,
        orderRevision: 3,
        sendWaveId,
        lineIds: [lineId],
        reason: "Send first round",
      }),
    ).toMatchObject({ sendWaveId, lineIds: [lineId] });
  });

  it("rejects duplicate line IDs", () => {
    expect(
      sendOrderWaveRequestSchema.safeParse({
        branchId,
        orderRevision: 3,
        sendWaveId,
        lineIds: [lineId, lineId],
        reason: "Duplicate round",
      }).success,
    ).toBe(false);
  });

  it("bounds queue filters and requires transition revisions", () => {
    expect(preparationTicketQuerySchema.parse({ limit: "200" }).limit).toBe(
      200,
    );
    expect(
      preparationTicketQuerySchema.safeParse({ limit: "201" }).success,
    ).toBe(false);
    expect(
      transitionPreparationTicketRequestSchema.safeParse({
        branchId,
        revision: 0,
        reason: "Start",
      }).success,
    ).toBe(false);
  });
});
