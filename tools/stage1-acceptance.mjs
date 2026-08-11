import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const apiBaseUrl = (
  process.env.STAGE1_API_BASE_URL ?? "http://127.0.0.1:3100/api/v1"
).replace(/\/$/, "");
const email = process.env.STAGE1_ACCEPTANCE_EMAIL?.trim().toLowerCase();
const password = process.env.STAGE1_ACCEPTANCE_PASSWORD;

if (!email || !password) {
  throw new Error(
    "STAGE1_ACCEPTANCE_EMAIL and STAGE1_ACCEPTANCE_PASSWORD are required.",
  );
}

const fixture = {
  branchId: "10000000-0000-4000-8000-000000000002",
  deviceId: "10000000-0000-4000-8000-000000000003",
  tableId: "10000000-0000-4000-8000-000000000012",
  stationId: "10000000-0000-4000-8000-000000000010",
  menuItemId: "10000000-0000-4000-8000-000000000017",
};

let accessToken = null;
let commandSequence = 0;

function commandKey(label) {
  commandSequence += 1;
  return `stage1:${label}:${commandSequence}:${randomUUID()}`;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", options.accept ?? "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body =
    response.status === 204
      ? null
      : contentType.includes("application/json")
        ? await response.json()
        : await response.text();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function expectRevision(value, label) {
  assert.equal(
    Number.isInteger(value),
    true,
    `${label} revision must be an integer`,
  );
  assert.equal(value > 0, true, `${label} revision must be positive`);
  return value;
}

async function run() {
  const health = await request("/health");
  assert.equal(health.status, "ok");
  assert.equal(health.database, "up");

  const session = await request("/auth/login", {
    method: "POST",
    body: { email, password, deviceId: fixture.deviceId },
  });
  accessToken = session.accessToken;
  assert.equal(session.scope.branchId, fixture.branchId);
  assert.equal(session.scope.deviceId, fixture.deviceId);

  const bootstrap = await request(`/sync/bootstrap/${fixture.branchId}`);
  assert.equal(
    bootstrap.tables.some((table) => table.id === fixture.tableId),
    true,
    "The active fictional table must be present in bootstrap.",
  );

  const shiftId = randomUUID();
  const shift = await request("/shifts/open", {
    method: "POST",
    idempotencyKey: commandKey("shift-open"),
    body: {
      shiftId,
      branchId: fixture.branchId,
      drawerKey: "STAGE1_ACCEPTANCE",
      openingFloatMinor: 5_000,
      reason: "Fictional Stage 1 acceptance shift",
    },
  });
  assert.equal(shift.id, shiftId);
  assert.equal(shift.status, "OPEN");
  const shiftRevision = expectRevision(shift.revision, "shift");

  const orderId = randomUUID();
  const orderRequest = {
    orderId,
    branchId: fixture.branchId,
    shiftId,
    clientReference: `stage1-${randomUUID()}`,
    channel: "DINE_IN",
    tableId: fixture.tableId,
    guestCount: 2,
    reason: "Fictional Stage 1 dine-in acceptance order",
  };
  const createOrderKey = commandKey("order-create");
  let order = await request("/orders", {
    method: "POST",
    idempotencyKey: createOrderKey,
    body: orderRequest,
  });
  const createReplay = await request("/orders", {
    method: "POST",
    idempotencyKey: createOrderKey,
    body: orderRequest,
  });
  assert.equal(
    createReplay.id,
    orderId,
    "Order creation replay must be idempotent.",
  );
  assert.equal(order.table.id, fixture.tableId);

  const originalLineId = randomUUID();
  order = await request(`/orders/${orderId}/lines`, {
    method: "POST",
    idempotencyKey: commandKey("line-add"),
    body: {
      lineId: originalLineId,
      branchId: fixture.branchId,
      orderRevision: expectRevision(order.revision, "order"),
      menuItemId: fixture.menuItemId,
      quantity: 1,
      modifiers: [],
      reason: "Add fictional acceptance item",
    },
  });

  const sentLineId = randomUUID();
  order = await request(`/orders/${orderId}/lines/${originalLineId}/replace`, {
    method: "POST",
    idempotencyKey: commandKey("line-replace"),
    body: {
      replacementLineId: sentLineId,
      branchId: fixture.branchId,
      orderRevision: expectRevision(order.revision, "order"),
      menuItemId: fixture.menuItemId,
      quantity: 2,
      note: "FICTIONAL acceptance replacement",
      modifiers: [],
      reason: "Exercise immutable draft replacement",
    },
  });

  const removedLineId = randomUUID();
  order = await request(`/orders/${orderId}/lines`, {
    method: "POST",
    idempotencyKey: commandKey("line-add-remove"),
    body: {
      lineId: removedLineId,
      branchId: fixture.branchId,
      orderRevision: expectRevision(order.revision, "order"),
      menuItemId: fixture.menuItemId,
      quantity: 1,
      modifiers: [],
      reason: "Add line that will be removed during acceptance",
    },
  });
  order = await request(`/orders/${orderId}/lines/${removedLineId}/remove`, {
    method: "POST",
    idempotencyKey: commandKey("line-remove"),
    body: {
      branchId: fixture.branchId,
      orderRevision: expectRevision(order.revision, "order"),
      reason: "Exercise retained draft removal history",
    },
  });

  order = await request(`/orders/${orderId}/hold`, {
    method: "POST",
    idempotencyKey: commandKey("order-hold"),
    body: {
      branchId: fixture.branchId,
      revision: expectRevision(order.revision, "order"),
      reason: "Exercise order hold",
    },
  });
  assert.equal(order.status, "HELD");
  order = await request(`/orders/${orderId}/resume`, {
    method: "POST",
    idempotencyKey: commandKey("order-resume"),
    body: {
      branchId: fixture.branchId,
      revision: expectRevision(order.revision, "order"),
      reason: "Resume fictional acceptance order",
    },
  });
  assert.equal(order.status, "OPEN");
  assert.equal(order.grossTotalMinor, 2_400);

  const sendRequest = {
    branchId: fixture.branchId,
    orderRevision: expectRevision(order.revision, "order"),
    sendWaveId: randomUUID(),
    lineIds: [sentLineId],
    reason: "Send fictional line to acceptance KDS",
  };
  const sendKey = commandKey("send-wave");
  const wave = await request(`/orders/${orderId}/send-waves`, {
    method: "POST",
    idempotencyKey: sendKey,
    body: sendRequest,
  });
  const waveReplay = await request(`/orders/${orderId}/send-waves`, {
    method: "POST",
    idempotencyKey: sendKey,
    body: sendRequest,
  });
  const ticketId = wave.sendWave.tickets[0]?.id;
  assert.equal(waveReplay.sendWave.tickets[0]?.id, ticketId);
  assert.ok(ticketId, "A preparation ticket must be created.");

  const stations = await request(`/kds/branches/${fixture.branchId}/stations`);
  assert.equal(
    stations.some(({ id }) => id === fixture.stationId),
    true,
  );
  const queue = await request(
    `/kds/branches/${fixture.branchId}/tickets?stationId=${fixture.stationId}`,
  );
  assert.equal(
    queue.some(({ id, status }) => id === ticketId && status === "QUEUED"),
    true,
  );

  let ticket = await request(
    `/kds/branches/${fixture.branchId}/tickets/${ticketId}`,
  );
  for (const [action, expected] of [
    ["preparing", "PREPARING"],
    ["ready", "READY"],
    ["complete", "COMPLETED"],
  ]) {
    ticket = await request(`/kds/tickets/${ticketId}/${action}`, {
      method: "POST",
      idempotencyKey: commandKey(`ticket-${action}`),
      body: {
        branchId: fixture.branchId,
        revision: expectRevision(ticket.revision, "ticket"),
        reason: `Stage 1 ticket ${action}`,
      },
    });
    assert.equal(ticket.status, expected);
  }

  const payment = await request(`/orders/${orderId}/payments`, {
    method: "POST",
    idempotencyKey: commandKey("cash-payment"),
    body: {
      paymentId: randomUUID(),
      branchId: fixture.branchId,
      shiftId,
      method: "CASH",
      amountMinor: 2_400,
      tenderedAmountMinor: 2_500,
      allocations: [
        {
          allocationId: randomUUID(),
          orderId,
          amountMinor: 2_400,
        },
      ],
      reason: "Record fictional Stage 1 cash tender",
    },
  });
  assert.equal(payment.status, "CONFIRMED");
  assert.equal(payment.changeMinor, 100);

  const completed = await request(`/orders/${orderId}/complete`, {
    method: "POST",
    idempotencyKey: commandKey("order-complete"),
    body: {
      branchId: fixture.branchId,
      revision: wave.orderRevision,
      reason: "Complete paid and prepared Stage 1 order",
    },
  });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.confirmedTotalMinor, 2_400);

  const receipt = await request(`/orders/${orderId}/receipts`, {
    method: "POST",
    idempotencyKey: commandKey("receipt-create"),
    body: {
      receiptId: randomUUID(),
      fiscalDocumentId: randomUUID(),
      branchId: fixture.branchId,
      orderRevision: completed.revision,
      reason: "Create fictional non-fiscal commercial receipt",
    },
  });
  assert.equal(receipt.fiscalDocument.status, "NOT_REQUIRED");
  assert.match(receipt.renderedHtml, /NOT A FISCAL RECEIPT/i);

  const renderedReceipt = await request(
    `/receipts/${receipt.id}/render?branchId=${fixture.branchId}`,
    { accept: "text/html" },
  );
  assert.match(renderedReceipt, /NOT A FISCAL RECEIPT/i);

  const reprint = await request(`/receipts/${receipt.id}/reprint`, {
    method: "POST",
    idempotencyKey: commandKey("receipt-reprint"),
    body: {
      reprintId: randomUUID(),
      printJobId: randomUUID(),
      branchId: fixture.branchId,
      copies: 1,
      reason: "Exercise audited Stage 1 receipt reprint",
    },
  });
  assert.equal(reprint.receiptId, receipt.id);

  const closedShift = await request(`/shifts/${shiftId}/close`, {
    method: "POST",
    idempotencyKey: commandKey("shift-close"),
    body: {
      branchId: fixture.branchId,
      revision: shiftRevision,
      countedCashMinor: 7_400,
      declaration: "FICTIONAL acceptance cash count agrees",
      reason: "Close reconciled Stage 1 acceptance shift",
    },
  });
  assert.equal(closedShift.status, "CLOSED");
  assert.equal(closedShift.close.varianceMinor, 0);

  const audit = await request(`/audit?branchId=${fixture.branchId}&limit=200`);
  const auditedActions = new Set(audit.items.map(({ action }) => action));
  for (const action of [
    "shifts.open",
    "orders.create",
    "orders.lines.replace",
    "orders.send_wave",
    "kds.tickets.completed",
    "payments.create",
    "orders.complete",
    "receipts.create",
    "receipts.reprint",
    "shifts.close",
  ]) {
    assert.equal(
      auditedActions.has(action),
      true,
      `Expected audit action ${action}.`,
    );
  }

  await request("/auth/logout", { method: "POST" });
  accessToken = null;

  console.info(
    JSON.stringify(
      {
        result: "PASS",
        branchId: fixture.branchId,
        shiftId,
        orderId,
        orderNumber: order.orderNumber,
        ticketId,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        grossTotalMinor: completed.confirmedTotalMinor,
        shiftVarianceMinor: closedShift.close.varianceMinor,
        auditedActionsChecked: 10,
        idempotentReplaysChecked: ["order.create", "order.send"],
      },
      null,
      2,
    ),
  );
}

await run();
