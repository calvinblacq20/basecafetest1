import {
  cashMovementListResponseSchema,
  cashMovementResponseSchema,
  completeOrderResponseSchema,
  orderListResponseSchema,
  orderOperationDetailResponseSchema,
  orderOperationOptionsResponseSchema,
  paymentListResponseSchema,
  paymentResponseSchema,
  refundListResponseSchema,
  refundResponseSchema,
  receiptResponseSchema,
  syncBootstrapResponseSchema,
  type OrderChannel,
  type CashMovementListResponse,
  type CashMovementResponse,
  type CashMovementType,
  type OrderListResponse,
  type OrderOperationDetailResponse,
  type OrderOperationOptionsResponse,
  type PaymentListResponse,
  type PaymentMethod,
  type PaymentResponse,
  type RefundKind,
  type RefundListResponse,
  type RefundResponse,
  type ReceiptResponse,
  type SyncBootstrapResponse,
} from "@base-cafe/contracts";
import { calculateOrderTotals, type TaxTreatment } from "@base-cafe/domain";
import {
  commandKey,
  requestJson,
  type WebSession,
} from "@base-cafe/web-client";

import type { IndexedDbSyncStore } from "./indexeddb-sync-store";
import type { SyncEngine } from "./sync-engine";

export type RuntimeSession = {
  accessToken: string;
  offlineUnlocked?: boolean;
  expiresAt: string;
  offlineAccess: {
    enabled: boolean;
    leaseExpiresAt: string | null;
    minimumPinLength: number;
    maximumFailedAttempts: number;
    lockoutSeconds: number;
  };
  scope: {
    organizationId: string;
    branchId: string;
    deviceId: string;
    userId: string;
  };
  user: {
    displayName: string;
    email: string;
    permissions: string[];
  };
};

export type LocalLineModifier = {
  lineModifierId: string;
  modifierId: string;
  name: string;
  priceDeltaMinor: number;
  chargedDeltaMinor: number;
};

export type LocalOrderLine = {
  id: string;
  menuItemId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  baseUnitPriceMinor: number;
  modifierUnitTotalMinor: number;
  taxTreatment: TaxTreatment;
  modifiers: LocalLineModifier[];
  sent: boolean;
};

export type WorkingOrder = {
  id: string;
  orderNumber: string;
  clientReference: string;
  shiftId: string;
  channel: OrderChannel;
  status: "OPEN" | "HELD" | "PAYMENT_QUEUED";
  tableId: string | null;
  tableName: string | null;
  guestCount: number | null;
  pickupReference: string | null;
  customerReference: string | null;
  tabName: string | null;
  note: string | null;
  revision: number;
  lines: LocalOrderLine[];
  totals: {
    inputSubtotalMinor: number;
    netTotalMinor: number;
    taxTotalMinor: number;
    grossTotalMinor: number;
  };
  tickets: SyncBootstrapResponse["orders"][number]["tickets"];
  confirmedPaymentMinor: number;
  createdAt: string;
};

export type CreateWorkingOrderInput = {
  channel: OrderChannel;
  tableId?: string;
  guestCount?: number;
  pickupReference?: string;
  customerReference?: string;
  tabName?: string;
  note?: string;
};

export type BootstrapResult = {
  data: SyncBootstrapResponse;
  source: "NETWORK" | "CACHE";
  stale: boolean;
};

const WORKING_ORDER_KEY = "working-order";
const BOOTSTRAP_KEY = "bootstrap";

function commandIdentity() {
  const commandId = crypto.randomUUID();
  return {
    commandId,
    createdAt: new Date().toISOString(),
    schemaVersion: 1 as const,
    idempotencyKey: `offline:${commandId}`,
  };
}

function totals(
  lines: readonly LocalOrderLine[],
  profile: NonNullable<SyncBootstrapResponse["taxProfile"]>,
) {
  return calculateOrderTotals(
    lines.map((line) => ({
      id: line.id,
      amountMinor:
        (line.baseUnitPriceMinor + line.modifierUnitTotalMinor) * line.quantity,
      treatment: line.taxTreatment,
    })),
    profile,
  );
}

export class CashierRuntime {
  private bootstrapSnapshot: SyncBootstrapResponse | null = null;
  private bootstrapSource: BootstrapResult["source"] | null = null;

  constructor(
    readonly session: RuntimeSession,
    readonly store: IndexedDbSyncStore,
    readonly engine: SyncEngine,
    private readonly apiBaseUrl: string,
  ) {}

  async bootstrap(): Promise<BootstrapResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/api/v1/sync/bootstrap/${this.session.scope.branchId}`,
        { headers: { authorization: `Bearer ${this.session.accessToken}` } },
      );
      if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`);
      const data = syncBootstrapResponseSchema.parse(await response.json());
      this.bootstrapSnapshot = data;
      this.bootstrapSource = "NETWORK";
      await this.store.putSnapshot("catalog", {
        id: BOOTSTRAP_KEY,
        value: data,
        cachedAt: data.generatedAt,
        expiresAt: data.expiresAt,
      });
      return { data, source: "NETWORK", stale: false };
    } catch (error) {
      const cached = await this.store.getSnapshot<SyncBootstrapResponse>(
        "catalog",
        BOOTSTRAP_KEY,
      );
      if (!cached) throw error;
      const data = syncBootstrapResponseSchema.parse(cached.snapshot.value);
      this.bootstrapSnapshot = data;
      this.bootstrapSource = "CACHE";
      return { data, source: "CACHE", stale: cached.stale };
    }
  }

  async currentOrder() {
    const cached = await this.store.getSnapshot<WorkingOrder>(
      "order",
      WORKING_ORDER_KEY,
    );
    const cachedOrder = cached?.snapshot.value;
    const server =
      this.bootstrapSnapshot?.orders.find(
        (candidate) => candidate.id === cachedOrder?.id,
      ) ?? this.bootstrapSnapshot?.orders[0];
    if (!server && cachedOrder && this.bootstrapSource === "NETWORK") {
      await this.store.deleteSnapshot("order", WORKING_ORDER_KEY);
      return null;
    }
    if (!server && cachedOrder)
      return {
        ...cachedOrder,
        tableId: cachedOrder.tableId ?? null,
        tableName: cachedOrder.tableName ?? null,
        guestCount: cachedOrder.guestCount ?? null,
        pickupReference: cachedOrder.pickupReference ?? null,
        customerReference: cachedOrder.customerReference ?? null,
        tabName: cachedOrder.tabName ?? null,
        note: cachedOrder.note ?? null,
        tickets: cachedOrder.tickets ?? [],
        confirmedPaymentMinor: cachedOrder.confirmedPaymentMinor ?? 0,
      };
    if (!server || !this.bootstrapSnapshot?.shift) return null;
    const order = this.mapServerOrder(server);
    await this.persist(order);
    return order;
  }

  async selectOrder(orderId: string) {
    const server = this.requireBootstrap().orders.find(
      (candidate) => candidate.id === orderId,
    );
    if (!server) throw new Error("ORDER_NOT_FOUND");
    const order = this.mapServerOrder(server);
    await this.persist(order);
    return order;
  }

  async listBranchOrders(status: "OPEN" | "HELD"): Promise<OrderListResponse> {
    if (!navigator.onLine) throw new Error("ORDER_LIST_REQUIRES_CONNECTION");
    const query = new URLSearchParams({ status, limit: "100" });
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/branches/${this.session.scope.branchId}?${query.toString()}`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return orderListResponseSchema.parse(response);
  }

  async getOrderForOperations(
    orderId: string,
  ): Promise<OrderOperationDetailResponse> {
    if (!navigator.onLine) throw new Error("ORDER_LIST_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/branches/${this.session.scope.branchId}/${orderId}`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return orderOperationDetailResponseSchema.parse(response);
  }

  async orderOperationOptions(): Promise<OrderOperationOptionsResponse> {
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/branches/${this.session.scope.branchId}/operation-options`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return orderOperationOptionsResponseSchema.parse(response);
  }

  async moveOrderTable(
    order: OrderOperationDetailResponse,
    tableId: string | null,
    allowTableConflict: boolean,
    reason: string,
  ) {
    return this.orderOperation(order.id, "move-table", {
      operationId: crypto.randomUUID(),
      branchId: this.session.scope.branchId,
      revision: order.revision,
      tableId,
      allowTableConflict,
      reason,
    });
  }

  async transferOrderResponsibility(
    order: OrderOperationDetailResponse,
    receivingUserId: string,
    reason: string,
  ) {
    return this.orderOperation(order.id, "transfer-owner", {
      operationId: crypto.randomUUID(),
      branchId: this.session.scope.branchId,
      revision: order.revision,
      receivingUserId,
      reason,
    });
  }

  async mergeOrder(
    target: OrderOperationDetailResponse,
    source: { id: string; revision: number },
    reason: string,
  ) {
    return this.orderOperation(target.id, "merge", {
      mergeId: crypto.randomUUID(),
      branchId: this.session.scope.branchId,
      targetRevision: target.revision,
      sourceOrderId: source.id,
      sourceRevision: source.revision,
      reason,
    });
  }

  async splitOrderLine(
    order: OrderOperationDetailResponse,
    line: { id: string; quantity: number },
    quantity: number,
    reason: string,
  ) {
    const partial = quantity < line.quantity;
    return this.orderOperation(order.id, "split", {
      splitId: crypto.randomUUID(),
      branchId: this.session.scope.branchId,
      sourceRevision: order.revision,
      newOrderId: crypto.randomUUID(),
      newClientReference: `POS-SPLIT-${Date.now().toString(36).toUpperCase()}`,
      tableId: null,
      allowTableConflict: false,
      lines: [
        {
          sourceLineId: line.id,
          targetLineId: crypto.randomUUID(),
          quantity,
          ...(partial ? { remainderLineId: crypto.randomUUID() } : {}),
        },
      ],
      reason,
    });
  }

  private orderOperation(
    orderId: string,
    operation: "move-table" | "transfer-owner" | "merge" | "split",
    body: Record<string, unknown>,
  ) {
    if (!navigator.onLine)
      throw new Error("ORDER_OPERATION_REQUIRES_CONNECTION");
    return requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/${orderId}/${operation}`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey(`order-${operation}`),
        onUnauthorized: () => this.unauthorized(),
        body,
      },
    );
  }

  private mapServerOrder(
    server: SyncBootstrapResponse["orders"][number],
  ): WorkingOrder {
    const shift = this.requireBootstrap().shift;
    if (!shift) throw new Error("ORDER_SHIFT_NOT_OPEN");
    return {
      id: server.id,
      orderNumber: server.orderNumber,
      clientReference: server.clientReference,
      shiftId: shift.id,
      channel: server.channel,
      status: server.status,
      tableId: server.tableId,
      tableName: server.tableName,
      guestCount: server.guestCount,
      pickupReference: server.pickupReference,
      customerReference: server.customerReference,
      tabName: server.tabName,
      note: server.note,
      revision: server.revision,
      lines: server.lines.map((line) => ({
        id: line.id,
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        name: line.name,
        variantName: line.variantName,
        quantity: line.quantity,
        baseUnitPriceMinor: line.baseUnitPriceMinor,
        modifierUnitTotalMinor: line.modifierUnitTotalMinor,
        taxTreatment: line.taxTreatment,
        modifiers: line.modifiers.map((modifier) => ({
          lineModifierId: modifier.id,
          modifierId: modifier.modifierId,
          name: modifier.name,
          priceDeltaMinor: modifier.configuredDeltaMinor,
          chargedDeltaMinor: modifier.chargedDeltaMinor,
        })),
        sent: line.sent,
      })),
      totals: {
        inputSubtotalMinor: server.inputSubtotalMinor,
        netTotalMinor: server.netTotalMinor,
        taxTotalMinor: server.taxTotalMinor,
        grossTotalMinor: server.grossTotalMinor,
      },
      tickets: server.tickets,
      confirmedPaymentMinor: server.confirmedPaymentMinor,
      createdAt: new Date().toISOString(),
    };
  }

  async createOrder(input: CreateWorkingOrderInput) {
    const bootstrap = this.requireBootstrap();
    if (!bootstrap.shift) throw new Error("ORDER_SHIFT_NOT_OPEN");
    if (!bootstrap.taxProfile) throw new Error("TAX_CONFIGURATION_MISSING");
    const orderId = crypto.randomUUID();
    const clientReference = `POS-${Date.now().toString(36).toUpperCase()}`;
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: orderId,
      commandType: "ORDER_CREATE",
      payload: {
        orderId,
        branchId: this.session.scope.branchId,
        shiftId: bootstrap.shift.id,
        clientReference,
        channel: input.channel,
        tableId: input.tableId,
        guestCount: input.guestCount,
        pickupReference: input.pickupReference,
        customerReference: input.customerReference,
        tabName: input.tabName,
        note: input.note,
        allowTableConflict: false,
        reason: "Created from enrolled POS device",
      },
    });
    const order: WorkingOrder = {
      id: orderId,
      orderNumber: "Pending sync",
      clientReference,
      shiftId: bootstrap.shift.id,
      channel: input.channel,
      status: "OPEN",
      tableId: input.tableId ?? null,
      tableName:
        bootstrap.tables.find((table) => table.id === input.tableId)?.name ??
        null,
      guestCount: input.guestCount ?? null,
      pickupReference: input.pickupReference ?? null,
      customerReference: input.customerReference ?? null,
      tabName: input.tabName ?? null,
      note: input.note ?? null,
      revision: 1,
      lines: [],
      totals: totals([], bootstrap.taxProfile),
      tickets: [],
      confirmedPaymentMinor: 0,
      createdAt: new Date().toISOString(),
    };
    await this.persist(order);
    return order;
  }

  async addLine(
    order: WorkingOrder,
    item: SyncBootstrapResponse["catalog"][number],
    selected: readonly LocalLineModifier[] = [],
  ) {
    this.assertWritable(order);
    const profile = this.requireTaxProfile();
    const lineId = crypto.randomUUID();
    const modifierUnitTotalMinor = selected.reduce(
      (sum, modifier) => sum + modifier.chargedDeltaMinor,
      0,
    );
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      commandType: "ORDER_LINE_ADD",
      payload: {
        lineId,
        branchId: this.session.scope.branchId,
        orderRevision: order.revision,
        menuItemId: item.menuItemId,
        variantId: item.variantId,
        quantity: 1,
        modifiers: selected.map((modifier) => ({
          lineModifierId: modifier.lineModifierId,
          modifierId: modifier.modifierId,
          quantity: 1,
        })),
        reason: "Added from enrolled POS device",
      },
    });
    const lines = [
      ...order.lines,
      {
        id: lineId,
        menuItemId: item.menuItemId,
        variantId: item.variantId,
        name: item.name,
        variantName: item.variantName,
        quantity: 1,
        baseUnitPriceMinor: item.priceMinor,
        modifierUnitTotalMinor,
        taxTreatment: item.taxTreatment,
        modifiers: [...selected],
        sent: false,
      },
    ];
    return this.persisted({
      ...order,
      revision: order.revision + 1,
      lines,
      totals: totals(lines, profile),
    });
  }

  async replaceQuantity(order: WorkingOrder, lineId: string, quantity: number) {
    this.assertWritable(order);
    const profile = this.requireTaxProfile();
    const line = order.lines.find((candidate) => candidate.id === lineId);
    if (!line || line.sent) throw new Error("SENT_LINE_IMMUTABLE");
    if (quantity <= 0) return this.removeLine(order, lineId);
    const replacementLineId = crypto.randomUUID();
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      targetLineId: lineId,
      commandType: "ORDER_LINE_REPLACE",
      payload: {
        replacementLineId,
        branchId: this.session.scope.branchId,
        orderRevision: order.revision,
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        quantity,
        modifiers: line.modifiers.map((modifier) => ({
          lineModifierId: crypto.randomUUID(),
          modifierId: modifier.modifierId,
          quantity: 1,
        })),
        reason: "Quantity changed from enrolled POS device",
      },
    });
    const lines = order.lines.map((candidate) =>
      candidate.id === lineId
        ? { ...candidate, id: replacementLineId, quantity }
        : candidate,
    );
    return this.persisted({
      ...order,
      revision: order.revision + 1,
      lines,
      totals: totals(lines, profile),
    });
  }

  async removeLine(order: WorkingOrder, lineId: string) {
    this.assertWritable(order);
    const profile = this.requireTaxProfile();
    const line = order.lines.find((candidate) => candidate.id === lineId);
    if (!line || line.sent) throw new Error("SENT_LINE_IMMUTABLE");
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      targetLineId: lineId,
      commandType: "ORDER_LINE_REMOVE",
      payload: {
        branchId: this.session.scope.branchId,
        orderRevision: order.revision,
        reason: "Removed from enrolled POS device",
      },
    });
    const lines = order.lines.filter((candidate) => candidate.id !== lineId);
    return this.persisted({
      ...order,
      revision: order.revision + 1,
      lines,
      totals: totals(lines, profile),
    });
  }

  async hold(order: WorkingOrder) {
    this.assertWritable(order);
    await this.revisionCommand(order, "ORDER_HOLD", "Order held by cashier");
    return this.persisted({
      ...order,
      status: "HELD",
      revision: order.revision + 1,
    });
  }

  async resume(order: WorkingOrder) {
    await this.revisionCommand(
      order,
      "ORDER_RESUME",
      "Order resumed by cashier",
    );
    return this.persisted({
      ...order,
      status: "OPEN",
      revision: order.revision + 1,
    });
  }

  async send(order: WorkingOrder) {
    this.assertWritable(order);
    const lineIds = order.lines
      .filter((line) => !line.sent)
      .map((line) => line.id);
    if (lineIds.length === 0) throw new Error("NO_DRAFT_LINES");
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      commandType: "ORDER_SEND",
      payload: {
        branchId: this.session.scope.branchId,
        orderRevision: order.revision,
        sendWaveId: crypto.randomUUID(),
        lineIds,
        reason: "Sent from enrolled POS device",
      },
    });
    return this.persisted({
      ...order,
      revision: order.revision + 1,
      lines: order.lines.map((line) =>
        lineIds.includes(line.id) ? { ...line, sent: true } : line,
      ),
    });
  }

  async cashPayment(
    order: WorkingOrder,
    tenderedAmountMinor: number,
    amountMinor = order.totals.grossTotalMinor - order.confirmedPaymentMinor,
  ) {
    if (order.totals.grossTotalMinor <= 0) throw new Error("ORDER_EMPTY");
    if (amountMinor <= 0) throw new Error("ORDER_PAYMENT_COMPLETE");
    if (tenderedAmountMinor < amountMinor)
      throw new Error("CASH_TENDERED_TOO_LOW");
    const paymentId = crypto.randomUUID();
    const payload = {
      paymentId,
      branchId: this.session.scope.branchId,
      shiftId: order.shiftId,
      method: "CASH" as const,
      amountMinor,
      tenderedAmountMinor,
      allocations: [
        {
          allocationId: crypto.randomUUID(),
          orderId: order.id,
          amountMinor,
        },
      ],
      reason: "Cash accepted on enrolled POS device",
    };
    if (typeof navigator !== "undefined" && navigator.onLine) {
      const response = await requestJson<unknown>(
        this.apiBaseUrl,
        `/api/v1/orders/${order.id}/payments`,
        {
          method: "POST",
          session: this.webSession(),
          idempotencyKey: commandKey("cash-tender-create"),
          onUnauthorized: () => this.unauthorized(),
          body: payload,
        },
      );
      paymentResponseSchema.parse(response);
      return this.persisted({
        ...order,
        confirmedPaymentMinor: order.confirmedPaymentMinor + amountMinor,
      });
    }
    await this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      commandType: "CASH_PAYMENT_CREATE",
      payload,
    });
    return this.persisted({
      ...order,
      status:
        order.confirmedPaymentMinor + amountMinor >=
        order.totals.grossTotalMinor
          ? "PAYMENT_QUEUED"
          : order.status,
    });
  }

  async listOrderPayments(orderId?: string): Promise<PaymentListResponse> {
    if (!navigator.onLine) throw new Error("PAYMENT_LIST_REQUIRES_CONNECTION");
    const query = new URLSearchParams({ limit: "100" });
    if (orderId) query.set("orderId", orderId);
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/payments/branches/${this.session.scope.branchId}?${query.toString()}`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return paymentListResponseSchema.parse(response);
  }

  async listRefunds(): Promise<RefundListResponse> {
    if (!navigator.onLine) throw new Error("REFUND_LIST_REQUIRES_CONNECTION");
    const query = new URLSearchParams({ limit: "100" });
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/refunds/branches/${this.session.scope.branchId}?${query.toString()}`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return refundListResponseSchema.parse(response);
  }

  async listCashMovements(shiftId?: string): Promise<CashMovementListResponse> {
    if (!navigator.onLine)
      throw new Error("CASH_MOVEMENT_LIST_REQUIRES_CONNECTION");
    const query = new URLSearchParams({ limit: "100" });
    if (shiftId) query.set("shiftId", shiftId);
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/cash-movements/branches/${this.session.scope.branchId}?${query.toString()}`,
      {
        session: this.webSession(),
        onUnauthorized: () => this.unauthorized(),
      },
    );
    return cashMovementListResponseSchema.parse(response);
  }

  async requestCashMovement(
    shift: { id: string; revision: number },
    input: {
      type: CashMovementType;
      direction: "IN" | "OUT";
      amountMinor: number;
      correctsMovementId?: string;
      reference?: string;
      evidenceNote: string;
      reason: string;
    },
  ): Promise<CashMovementResponse> {
    if (!navigator.onLine)
      throw new Error("CASH_MOVEMENT_REQUEST_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      "/api/v1/cash-movements",
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("cash-movement-request"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          movementId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          shiftId: shift.id,
          shiftRevision: shift.revision,
          ...input,
          correctsMovementId: input.correctsMovementId ?? null,
          reference: input.reference || null,
        },
      },
    );
    return cashMovementResponseSchema.parse(response);
  }

  async approveCashMovement(
    movement: CashMovementResponse,
    decision: "APPROVE" | "REJECT",
    evidenceNote: string,
    reason: string,
  ): Promise<CashMovementResponse> {
    if (!navigator.onLine)
      throw new Error("CASH_MOVEMENT_APPROVAL_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/cash-movements/${movement.id}/approve`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("cash-movement-approval"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          approvalId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          revision: movement.revision,
          decision,
          evidenceNote,
          reason,
        },
      },
    );
    return cashMovementResponseSchema.parse(response);
  }

  async requestRefund(
    payment: PaymentResponse,
    shiftId: string,
    input: {
      kind: RefundKind;
      amountMinor: number;
      evidenceNote: string;
      reason: string;
    },
  ): Promise<RefundResponse> {
    if (!navigator.onLine)
      throw new Error("REFUND_REQUEST_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/payments/${payment.id}/refunds`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("refund-request"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          refundId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          shiftId,
          paymentRevision: payment.revision,
          ...input,
        },
      },
    );
    return refundResponseSchema.parse(response);
  }

  async approveRefund(
    refund: RefundResponse,
    decision: "APPROVE" | "REJECT",
    evidenceNote: string,
    reason: string,
  ): Promise<RefundResponse> {
    if (!navigator.onLine)
      throw new Error("REFUND_APPROVAL_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/refunds/${refund.id}/approve`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("refund-approval"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          approvalId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          revision: refund.revision,
          decision,
          evidenceNote,
          reason,
        },
      },
    );
    return refundResponseSchema.parse(response);
  }

  async resolveRefund(
    refund: RefundResponse,
    outcome: "CONFIRMED" | "FAILED",
    providerReference: string,
    evidenceNote: string,
    reason: string,
  ): Promise<RefundResponse> {
    if (!navigator.onLine)
      throw new Error("REFUND_RESOLUTION_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/refunds/${refund.id}/resolve`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("refund-resolution"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          branchId: this.session.scope.branchId,
          revision: refund.revision,
          outcome,
          providerReference,
          evidenceNote,
          reason,
        },
      },
    );
    return refundResponseSchema.parse(response);
  }

  async createManualTender(
    order: WorkingOrder,
    input: {
      method: Exclude<PaymentMethod, "CASH">;
      amountMinor: number;
      externalReference: string;
      evidenceNote?: string;
    },
  ): Promise<PaymentResponse> {
    if (!navigator.onLine)
      throw new Error("ELECTRONIC_PAYMENT_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/${order.id}/payments`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("manual-tender-create"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          paymentId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          shiftId: order.shiftId,
          method: input.method,
          amountMinor: input.amountMinor,
          externalReference: input.externalReference,
          evidenceNote: input.evidenceNote,
          allocations: [
            {
              allocationId: crypto.randomUUID(),
              orderId: order.id,
              amountMinor: input.amountMinor,
            },
          ],
          reason: "Manual tender recorded on enrolled POS device",
        },
      },
    );
    return paymentResponseSchema.parse(response);
  }

  async verifyManualTender(
    payment: PaymentResponse,
    decision: "CONFIRM" | "FAIL",
    evidenceNote: string,
    reason: string,
  ): Promise<PaymentResponse> {
    if (!navigator.onLine)
      throw new Error("PAYMENT_VERIFICATION_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/payments/${payment.id}/verify-manual`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("manual-tender-verify"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          verificationId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          revision: payment.revision,
          decision,
          evidenceNote,
          reason,
        },
      },
    );
    return paymentResponseSchema.parse(response);
  }

  async synchronize(orderId?: string) {
    if (!navigator.onLine) throw new Error("SYNC_REQUIRES_CONNECTION");
    await this.engine.flush();
    const summary = await this.engine.summary();
    if (summary.pending + summary.sending > 0)
      throw new Error("SYNC_STILL_PENDING");
    if (summary.conflicts + summary.failed > 0)
      throw new Error("SYNC_REQUIRES_REVIEW");
    const bootstrap = await this.bootstrap();
    const order = orderId
      ? await this.selectOrder(orderId).catch(() => null)
      : await this.currentOrder();
    return { bootstrap, order, summary };
  }

  async complete(order: WorkingOrder) {
    if (!navigator.onLine)
      throw new Error("ORDER_COMPLETE_REQUIRES_CONNECTION");
    const summary = await this.engine.summary();
    if (
      summary.pending + summary.sending + summary.conflicts + summary.failed >
      0
    )
      throw new Error("ORDER_COMPLETE_REQUIRES_SYNC");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/${order.id}/complete`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("order-complete"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          branchId: this.session.scope.branchId,
          revision: order.revision,
          reason: "Cashier completed a fully paid and prepared order",
        },
      },
    );
    const completed = completeOrderResponseSchema.parse(response);
    await this.store.deleteSnapshot("order", WORKING_ORDER_KEY);
    return completed;
  }

  async createReceipt(orderId: string, orderRevision: number) {
    if (!navigator.onLine)
      throw new Error("RECEIPT_CREATE_REQUIRES_CONNECTION");
    const response = await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/orders/${orderId}/receipts`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("receipt-create"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          receiptId: crypto.randomUUID(),
          fiscalDocumentId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          orderRevision,
          reason: "Cashier created the commercial receipt after completion",
        },
      },
    );
    return receiptResponseSchema.parse(response);
  }

  async renderReceipt(receipt: ReceiptResponse, reprint = false) {
    const query = new URLSearchParams({
      branchId: this.session.scope.branchId,
      ...(reprint ? { reprint: "true" } : {}),
    });
    return requestJson<string>(
      this.apiBaseUrl,
      `/api/v1/receipts/${receipt.id}/render?${query.toString()}`,
      {
        session: this.webSession(),
        headers: { accept: "text/html" },
        onUnauthorized: () => this.unauthorized(),
      },
    );
  }

  async reprintReceipt(receipt: ReceiptResponse) {
    await requestJson<unknown>(
      this.apiBaseUrl,
      `/api/v1/receipts/${receipt.id}/reprint`,
      {
        method: "POST",
        session: this.webSession(),
        idempotencyKey: commandKey("receipt-reprint"),
        onUnauthorized: () => this.unauthorized(),
        body: {
          reprintId: crypto.randomUUID(),
          printJobId: crypto.randomUUID(),
          branchId: this.session.scope.branchId,
          copies: 1,
          reason: "Cashier requested a commercial receipt reprint",
        },
      },
    );
    return this.renderReceipt(receipt, true);
  }

  async openShift(openingFloatMinor: number) {
    if (!navigator.onLine) throw new Error("SHIFT_OPEN_REQUIRES_CONNECTION");
    const shiftId = crypto.randomUUID();
    const response = await fetch(`${this.apiBaseUrl}/api/v1/shifts/open`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.session.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": `shift-open:${shiftId}`,
      },
      body: JSON.stringify({
        shiftId,
        branchId: this.session.scope.branchId,
        openingFloatMinor,
        reason: "Cashier opened shift on the enrolled POS device",
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        code?: string;
      } | null;
      throw new Error(
        body?.code ?? body?.message ?? `SHIFT_OPEN_HTTP_${response.status}`,
      );
    }
    return response.json();
  }
  async closeShift(countedCashMinor: number) {
    const bootstrap = this.requireBootstrap();
    if (!bootstrap.shift) throw new Error("SHIFT_NOT_OPEN");
    if (!navigator.onLine) throw new Error("SHIFT_CLOSE_REQUIRES_CONNECTION");
    const summary = await this.engine.summary();
    const unresolved =
      summary.pending + summary.sending + summary.conflicts + summary.failed;
    if (unresolved > 0) throw new Error("SHIFT_UNSYNCED_COMMANDS");
    const commandId = crypto.randomUUID();
    const response = await fetch(
      `${this.apiBaseUrl}/api/v1/shifts/${bootstrap.shift.id}/close`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.session.accessToken}`,
          "content-type": "application/json",
          "idempotency-key": `shift-close:${commandId}`,
        },
        body: JSON.stringify({
          branchId: this.session.scope.branchId,
          revision: bootstrap.shift.revision,
          countedCashMinor,
          declaration: "Cash counted on the enrolled POS device",
          reason: "Cashier requested shift close after local sync cleared",
        }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        code?: string;
      } | null;
      throw new Error(
        body?.code ?? body?.message ?? `SHIFT_CLOSE_HTTP_${response.status}`,
      );
    }
    return response.json();
  }
  private revisionCommand(
    order: WorkingOrder,
    commandType: "ORDER_HOLD" | "ORDER_RESUME",
    reason: string,
  ) {
    return this.engine.enqueue({
      ...commandIdentity(),
      branchId: this.session.scope.branchId,
      deviceId: this.session.scope.deviceId,
      actorId: this.session.scope.userId,
      aggregateId: order.id,
      commandType,
      payload: {
        branchId: this.session.scope.branchId,
        revision: order.revision,
        reason,
      },
    });
  }

  private requireBootstrap() {
    if (!this.bootstrapSnapshot) throw new Error("BOOTSTRAP_REQUIRED");
    return this.bootstrapSnapshot;
  }

  private requireTaxProfile() {
    const profile = this.requireBootstrap().taxProfile;
    if (!profile) throw new Error("TAX_CONFIGURATION_MISSING");
    return profile;
  }

  private assertWritable(order: WorkingOrder) {
    if (order.status !== "OPEN") throw new Error("ORDER_NOT_WRITABLE");
  }

  private webSession(): WebSession {
    return {
      accessToken: this.session.accessToken,
      expiresAt: this.session.expiresAt,
      offlineAccess: this.session.offlineAccess,
      scope: {
        organizationId: this.session.scope.organizationId,
        branchId: this.session.scope.branchId,
        deviceId: this.session.scope.deviceId,
      },
      user: {
        id: this.session.scope.userId,
        displayName: this.session.user.displayName,
        email: this.session.user.email,
        permissions: this.session.user.permissions,
        mustChangePassword: false,
        mfaActive: false,
      },
    };
  }

  private unauthorized() {
    window.dispatchEvent(new Event("base-cafe:pos-unauthorized"));
  }

  private async persisted(order: WorkingOrder) {
    await this.persist(order);
    return order;
  }

  private async persist(order: WorkingOrder) {
    const now = new Date();
    await this.store.putSnapshot("order", {
      id: WORKING_ORDER_KEY,
      value: order,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
    });
  }
}
