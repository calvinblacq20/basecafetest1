import type { SyncBootstrapResponse } from "@base-cafe/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CashierRuntime,
  type RuntimeSession,
  type WorkingOrder,
} from "./cashier-runtime";
import { SyncEngine } from "./sync-engine";
import { MemorySyncStore } from "./sync-store";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

class SnapshotStore extends MemorySyncStore {
  private readonly snapshots = new Map<string, unknown>();

  async putSnapshot<T>(
    kind: string,
    snapshot: { id: string; value: T; cachedAt: string; expiresAt: string },
  ) {
    this.snapshots.set(`${kind}:${snapshot.id}`, snapshot);
  }

  async getSnapshot<T>(kind: string, key: string) {
    const snapshot = this.snapshots.get(`${kind}:${key}`) as
      { id: string; value: T; cachedAt: string; expiresAt: string } | undefined;
    return snapshot ? { snapshot, stale: false } : null;
  }

  async deleteSnapshot(kind: string, key: string) {
    this.snapshots.delete(`${kind}:${key}`);
  }
}

const bootstrap: SyncBootstrapResponse = {
  generatedAt: "2026-08-07T12:00:00.000Z",
  expiresAt: "2026-08-07T20:00:00.000Z",

  branch: {
    id: id(1),
    name: "Base Cafe",
    timezone: "Africa/Accra",
    currency: "GHS",
  },
  tables: [],
  shift: {
    id: id(5),
    revision: 1,
    businessDate: "2026-08-07",
    currency: "GHS",
    openingFloatMinor: 0,
  },
  taxProfile: {
    id: id(6),
    name: "Approved tax",
    priceMode: "EXCLUSIVE",
    roundingMode: "HALF_UP",
    roundingScope: "LINE",
    components: [
      {
        id: id(7),
        code: "VAT",
        receiptLabel: "VAT",
        ratePpm: 150_000,
        calculationOrder: 1,
      },
    ],
  },
  catalog: [
    {
      menuItemId: id(8),
      variantId: null,
      name: "Configured item",
      variantName: null,
      categoryId: id(9),
      categoryName: "Meals",
      imageUrl: null,
      priceMinor: 1000,
      taxTreatment: "STANDARD",
      modifierGroups: [],
    },
  ],
  orders: [],
};

const session: RuntimeSession = {
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
    organizationId: id(2),
    branchId: id(1),
    deviceId: id(3),
    userId: id(4),
  },
  user: {
    displayName: "Cashier",
    email: "cashier@example.test",
    permissions: [],
  },
};

afterEach(() => vi.restoreAllMocks());

describe("CashierRuntime", () => {
  it("persists an optimistic order before replay and calculates exact cached tax", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(bootstrap),
      }),
    );
    const store = new SnapshotStore();
    const engine = new SyncEngine(store, vi.fn(), () => false);
    const runtime = new CashierRuntime(
      session,
      store as never,
      engine,
      "http://localhost:3100",
    );
    await runtime.bootstrap();
    const created = await runtime.createOrder({
      channel: "DINE_IN",
      guestCount: 2,
    });
    const updated = await runtime.addLine(created, bootstrap.catalog[0]!);

    expect(updated.revision).toBe(2);
    expect(updated.totals).toEqual({
      inputSubtotalMinor: 1000,
      netTotalMinor: 1000,
      taxTotalMinor: 150,
      grossTotalMinor: 1150,
    });
    expect((await store.list()).map((command) => command.commandType)).toEqual([
      "ORDER_CREATE",
      "ORDER_LINE_ADD",
    ]);
    expect(
      (await store.getSnapshot("order", "working-order"))?.snapshot.value,
    ).toMatchObject({
      id: updated.id,
      revision: 2,
    });
    const createCommand = (await store.list())[0];
    expect(createCommand?.commandType).toBe("ORDER_CREATE");
    if (createCommand?.commandType !== "ORDER_CREATE")
      throw new Error("Expected an order-create command.");
    expect(createCommand.payload).toMatchObject({
      channel: "DINE_IN",
      guestCount: 2,
    });
    expect(createCommand.payload.customerReference).toBeUndefined();
  });

  it("uses explicit replacement and cash commands instead of mutating history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(bootstrap),
      }),
    );
    const store = new SnapshotStore();
    const engine = new SyncEngine(store, vi.fn(), () => false);
    const runtime = new CashierRuntime(
      session,
      store as never,
      engine,
      "http://localhost:3100",
    );
    await runtime.bootstrap();
    const created = await runtime.createOrder({ channel: "TAKEAWAY" });
    const withLine = await runtime.addLine(created, bootstrap.catalog[0]!);
    const replaced = await runtime.replaceQuantity(
      withLine,
      withLine.lines[0]!.id,
      2,
    );
    await runtime.cashPayment(replaced, 2500);

    expect((await store.list()).map((command) => command.commandType)).toEqual([
      "ORDER_CREATE",
      "ORDER_LINE_ADD",
      "ORDER_LINE_REPLACE",
      "CASH_PAYMENT_CREATE",
    ]);
    expect(replaced.totals.grossTotalMinor).toBe(2300);
  });

  it("queues an exact partial cash allocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(bootstrap),
      }),
    );
    const store = new SnapshotStore();
    const runtime = new CashierRuntime(
      session,
      store as never,
      new SyncEngine(store, vi.fn(), () => false),
      "http://localhost:3100",
    );
    await runtime.bootstrap();
    const created = await runtime.createOrder({ channel: "TAKEAWAY" });
    const withLine = await runtime.addLine(created, bootstrap.catalog[0]!);
    const next = await runtime.cashPayment(withLine, 600, 500);
    const command = (await store.list()).at(-1);

    expect(command?.commandType).toBe("CASH_PAYMENT_CREATE");
    expect(command?.payload).toMatchObject({
      amountMinor: 500,
      tenderedAmountMinor: 600,
      allocations: [{ orderId: withLine.id, amountMinor: 500 }],
    });
    expect(next.status).toBe("OPEN");
  });

  it("records a manual tender online without provider claims", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const response = {
      id: id(30),
      branchId: session.scope.branchId,
      orderId: id(31),
      shiftId: bootstrap.shift!.id,
      createdById: session.scope.userId,
      createdByDisplayName: session.user.displayName,
      method: "MANUAL_MOMO",
      status: "REQUIRES_VERIFICATION",
      currency: "GHS",
      amountMinor: 650,
      tenderedAmountMinor: null,
      changeMinor: 0,
      externalReference: "FICTIONAL-REF-001",
      evidenceNote: null,
      revision: 1,
      confirmedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-09T10:00:00.000Z",
      allocations: [
        {
          id: id(32),
          orderId: id(31),
          amountMinor: 650,
          order: { orderNumber: "20260809-0001", grossTotalMinor: 1_150 },
        },
      ],
      verification: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(response),
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new SnapshotStore();
    const runtime = new CashierRuntime(
      session,
      store as never,
      new SyncEngine(store, vi.fn(), () => true),
      "http://localhost:3100",
    );
    const order = {
      id: id(31),
      orderNumber: "20260809-0001",
      clientReference: "TEST-ORDER",
      shiftId: bootstrap.shift!.id,
      channel: "TAKEAWAY" as const,
      status: "OPEN" as const,
      tableId: null,
      tableName: null,
      guestCount: null,
      pickupReference: null,
      customerReference: null,
      tabName: null,
      note: null,
      revision: 2,
      lines: [],
      totals: {
        inputSubtotalMinor: 1_000,
        netTotalMinor: 1_000,
        taxTotalMinor: 150,
        grossTotalMinor: 1_150,
      },
      tickets: [],
      confirmedPaymentMinor: 0,
      createdAt: "2026-08-09T10:00:00.000Z",
    };

    await runtime.createManualTender(order, {
      method: "MANUAL_MOMO",
      amountMinor: 650,
      externalReference: "FICTIONAL-REF-001",
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      method: "MANUAL_MOMO",
      amountMinor: 650,
      externalReference: "FICTIONAL-REF-001",
    });
    expect(String(request.body)).not.toContain("network");
    expect(String(request.body)).not.toContain("merchantAccountReference");
  });

  it("removes a completed order from the working snapshot", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const store = new SnapshotStore();
    const engine = new SyncEngine(store, vi.fn(), () => true);
    const runtime = new CashierRuntime(
      session,
      store as never,
      engine,
      "http://localhost:3100",
    );
    const order: WorkingOrder = {
      id: id(20),
      orderNumber: "20260807-0001",
      clientReference: "test-completion",
      shiftId: bootstrap.shift!.id,
      channel: "DINE_IN",
      status: "OPEN",
      tableId: null,
      tableName: null,
      guestCount: 1,
      pickupReference: null,
      customerReference: null,
      tabName: null,
      note: null,
      revision: 4,
      lines: [],
      totals: {
        inputSubtotalMinor: 1_000,
        netTotalMinor: 1_000,
        taxTotalMinor: 150,
        grossTotalMinor: 1_150,
      },
      tickets: [],
      confirmedPaymentMinor: 1_150,
      createdAt: "2026-08-07T12:00:00.000Z",
    };
    await store.putSnapshot("order", {
      id: "working-order",
      value: order,
      cachedAt: order.createdAt,
      expiresAt: "2026-08-14T12:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            orderId: order.id,
            status: "COMPLETED",
            revision: 5,
            completedAt: "2026-08-07T12:01:00.000Z",
            confirmedTotalMinor: 1_150,
            compositionOrderIds: [order.id],
            inventory: { enabled: false, postedConsumptionIds: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await runtime.complete(order);

    expect(await store.getSnapshot("order", "working-order")).toBeNull();
  });

  it("loads the typed branch order list and sends revision-aware manager commands", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const summary = {
      id: id(20),
      orderNumber: "20260807-0001",
      clientReference: "POS-TEST-1",
      channel: "DINE_IN",
      status: "OPEN",
      revision: 3,
      businessDate: "2026-08-07",
      createdAt: "2026-08-07T12:00:00.000Z",
      updatedAt: "2026-08-07T12:01:00.000Z",
      table: null,
      assignedServer: { id: id(4), displayName: "Cashier" },
      guestCount: 2,
      pickupReference: null,
      customerReference: null,
      tabName: null,
      activeLineCount: 1,
      grossTotalMinor: 1150,
    } as const;
    const detail = {
      ...summary,
      businessDate: "2026-08-07T00:00:00.000Z",
      lines: [
        {
          id: id(21),
          status: "DRAFT" as const,
          itemNameSnapshot: "Fictional item",
          variantNameSnapshot: null,
          quantity: 1,
          grossAmountMinor: 1150,
          sentAt: null,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([summary]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orderId: summary.id, revision: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const runtime = new CashierRuntime(
      { ...session, expiresAt: "2030-08-07T20:00:00.000Z" },
      new SnapshotStore() as never,
      new SyncEngine(new SnapshotStore(), vi.fn(), () => true),
      "http://localhost:3100",
    );

    expect(await runtime.listBranchOrders("OPEN")).toEqual([summary]);
    await runtime.moveOrderTable(
      detail,
      id(22),
      false,
      "Guest requested another table",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("status=OPEN");
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(new Headers(request.headers).get("idempotency-key")).toContain(
      "order-move-table",
    );
    expect(JSON.parse(String(request.body))).toMatchObject({
      branchId: session.scope.branchId,
      revision: 3,
      tableId: id(22),
      reason: "Guest requested another table",
    });
  });

  it("sends online refund commands with revision and separation-safe fields", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const payment = {
      id: id(40),
      branchId: id(1),
      orderId: id(41),
      shiftId: id(5),
      createdById: id(4),
      createdByDisplayName: "Cashier",
      method: "MANUAL_MOMO" as const,
      status: "CONFIRMED" as const,
      currency: "GHS" as const,
      amountMinor: 1_200,
      tenderedAmountMinor: null,
      changeMinor: 0,
      externalReference: "FICTIONAL-PAYMENT-001",
      evidenceNote: null,
      revision: 2,
      confirmedAt: "2026-08-09T12:00:00.000Z",
      failedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-09T11:55:00.000Z",
      allocations: [
        {
          id: id(42),
          orderId: id(41),
          amountMinor: 1_200,
          order: {
            orderNumber: "20260809-0001",
            grossTotalMinor: 1_200,
          },
        },
      ],
      verification: null,
    };
    const refund = {
      id: id(43),
      branchId: id(1),
      paymentId: payment.id,
      orderId: payment.orderId,
      shiftId: id(5),
      requestedById: id(4),
      requestedByDisplayName: "Cashier",
      resolvedById: null,
      resolvedByDisplayName: null,
      kind: "REFUND" as const,
      status: "AWAITING_APPROVAL" as const,
      fiscalStatus: "NOT_REQUIRED" as const,
      currency: "GHS" as const,
      amountMinor: 200,
      evidenceNote: "Fictional evidence",
      providerReference: null,
      reason: "Fictional acceptance return",
      revision: 1,
      confirmedAt: null,
      failedAt: null,
      rejectedAt: null,
      createdAt: "2026-08-09T12:01:00.000Z",
      updatedAt: "2026-08-09T12:01:00.000Z",
      payment: { method: "MANUAL_MOMO" as const, amountMinor: 1_200 },
      order: { orderNumber: "20260809-0001", grossTotalMinor: 1_200 },
      approval: null,
      document: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refund), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...refund,
            status: "PENDING_PROVIDER",
            revision: 2,
            approval: {
              id: id(44),
              approverId: id(45),
              approverDisplayName: "Independent manager",
              decision: "APPROVE",
              evidenceNote: "Approval evidence",
              reason: "Approved test request",
              createdAt: "2026-08-09T12:02:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = new SnapshotStore();
    const runtime = new CashierRuntime(
      { ...session, expiresAt: "2030-08-07T20:00:00.000Z" },
      store as never,
      new SyncEngine(store, vi.fn(), () => true),
      "http://localhost:3100",
    );

    const requested = await runtime.requestRefund(payment, id(5), {
      kind: "REFUND",
      amountMinor: 200,
      evidenceNote: "Fictional evidence",
      reason: "Fictional acceptance return",
    });
    await runtime.approveRefund(
      requested,
      "APPROVE",
      "Approval evidence",
      "Approved test request",
    );

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(requestBody).toMatchObject({
      branchId: session.scope.branchId,
      shiftId: id(5),
      paymentRevision: 2,
      amountMinor: 200,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/payments/${payment.id}/refunds`,
    );
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get(
        "idempotency-key",
      ),
    ).toContain("refund-approval");
    expect(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).not.toContain("customer");
  });

  it("sends online correction and independent cash approval commands", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const sourceId = id(50);
    const movement = {
      id: id(51),
      branchId: session.scope.branchId,
      shiftId: bootstrap.shift!.id,
      requestedById: session.scope.userId,
      requestedByDisplayName: session.user.displayName,
      type: "CORRECTION" as const,
      direction: "OUT" as const,
      status: "AWAITING_APPROVAL" as const,
      revision: 1,
      currency: "GHS" as const,
      amountMinor: 250,
      reference: "FICTIONAL-CORRECTION-001",
      evidenceNote: "Recount evidence",
      reason: "Correct fictional paid-in",
      correctsMovement: {
        id: sourceId,
        type: "PAID_IN" as const,
        direction: "IN" as const,
        amountMinor: 500,
        reference: "FICTIONAL-PAID-IN-001",
      },
      approval: null,
      postedAt: null,
      rejectedAt: null,
      createdAt: "2026-08-09T13:00:00.000Z",
      updatedAt: "2026-08-09T13:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(movement), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...movement,
            status: "POSTED",
            revision: 2,
            postedAt: "2026-08-09T13:01:00.000Z",
            updatedAt: "2026-08-09T13:01:00.000Z",
            approval: {
              id: id(52),
              approverId: id(53),
              approverDisplayName: "Independent manager",
              decision: "APPROVE",
              evidenceNote: "Reviewed evidence",
              reason: "Approved fictional correction",
              createdAt: "2026-08-09T13:01:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const store = new SnapshotStore();
    const runtime = new CashierRuntime(
      { ...session, expiresAt: "2030-08-07T20:00:00.000Z" },
      store as never,
      new SyncEngine(store, vi.fn(), () => true),
      "http://localhost:3100",
    );

    const requested = await runtime.requestCashMovement(bootstrap.shift!, {
      type: "CORRECTION",
      direction: "OUT",
      amountMinor: 250,
      correctsMovementId: sourceId,
      reference: "FICTIONAL-CORRECTION-001",
      evidenceNote: "Recount evidence",
      reason: "Correct fictional paid-in",
    });
    await runtime.approveCashMovement(
      requested,
      "APPROVE",
      "Reviewed evidence",
      "Approved fictional correction",
    );

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(requestBody).toMatchObject({
      shiftRevision: bootstrap.shift!.revision,
      type: "CORRECTION",
      direction: "OUT",
      amountMinor: 250,
      correctsMovementId: sourceId,
    });
    const approvalBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(approvalBody).toMatchObject({
      revision: 1,
      decision: "APPROVE",
    });
    expect(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).not.toContain("customer");
  });
});
