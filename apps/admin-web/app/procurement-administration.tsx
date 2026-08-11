"use client";

import type {
  GoodsReceiptResponse,
  InventoryItemResponse,
  InventoryUnitResponse,
  ProcurementValuationResponse,
  PurchaseOrderResponse,
  PurchaseReturnResponse,
  StockLocationResponse,
  SupplierResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createPurchaseOrder,
  createSupplier,
  createSupplierItem,
  listGoodsReceipts,
  listInventoryItems,
  listInventoryUnits,
  listPurchaseOrders,
  listPurchaseReturns,
  listStockLocations,
  listSuppliers,
  loadProcurementValuation,
  postGoodsReceipt,
  postPurchaseReturn,
  transitionPurchaseOrder,
  type AdminSession,
} from "./admin-client";

type ProcurementData = {
  suppliers: SupplierResponse[];
  orders: PurchaseOrderResponse[];
  receipts: GoodsReceiptResponse[];
  returns: PurchaseReturnResponse[];
  valuation: ProcurementValuationResponse;
  items: InventoryItemResponse[];
  units: InventoryUnitResponse[];
  locations: StockLocationResponse[];
};
type View = "suppliers" | "orders" | "receipts" | "returns" | "valuation";

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The procurement request could not be completed.";
}

function iso(value: FormDataEntryValue | null) {
  return new Date(String(value)).toISOString();
}

function formatMicros(value: string, code?: string) {
  const quantity = BigInt(value);
  const negative = quantity < 0n;
  const absolute = negative ? -quantity : quantity;
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "−" : ""}${absolute / 1_000_000n}${
    fraction ? `.${fraction}` : ""
  }${code ? ` ${code}` : ""}`;
}

function formatMoney(value: number, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
  }).format(value / 100);
}

export function ProcurementAdministration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<View>("suppliers");
  const [data, setData] = useState<ProcurementData | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "denied" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canRead = session.user.permissions.includes("procurement.read");
  const canConfigure = session.user.permissions.includes(
    "procurement.configure",
  );
  const canWrite = session.user.permissions.includes("procurement.write");
  const canManage = session.user.permissions.includes("procurement.manage");

  const load = useCallback(async () => {
    if (!canRead) {
      setStatus("denied");
      setMessage("The current session does not have procurement.read.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const [
        suppliers,
        orders,
        receipts,
        returns,
        valuation,
        items,
        units,
        locations,
      ] = await Promise.all([
        listSuppliers(session),
        listPurchaseOrders(session),
        listGoodsReceipts(session),
        listPurchaseReturns(session),
        loadProcurementValuation(session),
        listInventoryItems(session),
        listInventoryUnits(session),
        listStockLocations(session),
      ]);
      setData({
        suppliers,
        orders,
        receipts,
        returns,
        valuation,
        items,
        units,
        locations,
      });
      setStatus("ready");
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 403 ? "denied" : "error",
      );
      setMessage(messageFor(error));
    }
  }, [canRead, session]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
    };
  }, [load]);

  async function perform(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await task();
      await load();
      notify(success);
      return true;
    } catch (error) {
      notify(messageFor(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const supplierItems = useMemo(
    () => data?.suppliers.flatMap((supplier) => supplier.items) ?? [],
    [data],
  );

  async function supplierCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const lead = String(values.get("leadTimeDays") ?? "");
    if (
      await perform(
        () =>
          createSupplier(session, {
            externalKey: String(values.get("externalKey")),
            name: String(values.get("name")),
            contactName: String(values.get("contactName")) || undefined,
            phone: String(values.get("phone")) || undefined,
            email: String(values.get("email")) || undefined,
            paymentTerms: String(values.get("paymentTerms")) || undefined,
            leadTimeDays: lead ? Number(lead) : undefined,
            reason: String(values.get("reason")),
          }),
        "Supplier created with audit and outbox history.",
      )
    )
      form.reset();
  }

  async function supplierItemCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createSupplierItem(session, {
            supplierId: String(values.get("supplierId")),
            inventoryItemId: String(values.get("inventoryItemId")),
            purchaseUnitId: String(values.get("purchaseUnitId")),
            supplierSku: String(values.get("supplierSku")) || undefined,
            reason: String(values.get("reason")),
          }),
        "Supplier item linked through an exact purchase unit.",
      )
    )
      form.reset();
  }

  async function orderCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const configured = supplierItems.find(
      (item) => item.id === String(values.get("supplierItemId")),
    );
    if (!configured) return notify("Select a configured supplier item.");
    if (
      await perform(
        () =>
          createPurchaseOrder(session, {
            supplierId: configured.supplierId,
            clientReference: String(values.get("clientReference")),
            expectedAt: values.get("expectedAt")
              ? iso(values.get("expectedAt"))
              : undefined,
            lines: [
              {
                supplierItemId: configured.id,
                orderedQuantityMicros: String(values.get("quantityMicros")),
                unitCostMinor: Number(values.get("unitCostMinor")),
              },
            ],
            reason: String(values.get("reason")),
          }),
        "Draft purchase order created with immutable line snapshots.",
      )
    )
      form.reset();
  }

  async function orderTransition(
    event: FormEvent<HTMLFormElement>,
    order: PurchaseOrderResponse,
    action: "submit" | "cancel",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => transitionPurchaseOrder(session, order, action, reason),
        `Purchase order ${action === "submit" ? "submitted" : "cancelled"} with retained history.`,
      )
    )
      form.reset();
  }

  async function receiptPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const order = data?.orders.find(
      (entry) => entry.id === values.get("orderId"),
    );
    if (!order) return notify("Select a submitted purchase order.");
    if (
      await perform(
        () =>
          postGoodsReceipt(session, order, {
            supplierDocumentReference:
              String(values.get("supplierDocumentReference")) || undefined,
            receivedAt: iso(values.get("receivedAt")),
            lines: [
              {
                purchaseOrderLineId: String(values.get("purchaseOrderLineId")),
                locationId: String(values.get("locationId")),
                receivedQuantityMicros: String(
                  values.get("receivedQuantityMicros"),
                ),
                lotReference: String(values.get("lotReference")) || undefined,
                expiresOn: String(values.get("expiresOn")) || undefined,
              },
            ],
            reason: String(values.get("reason")),
          }),
        "Goods receipt posted to the immutable stock ledger.",
      )
    )
      form.reset();
  }

  async function returnPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const receipt = data?.receipts.find(
      (entry) => entry.id === values.get("receiptId"),
    );
    if (!receipt) return notify("Select a retained goods receipt.");
    if (
      await perform(
        () =>
          postPurchaseReturn(session, receipt, {
            supplierDocumentReference:
              String(values.get("supplierDocumentReference")) || undefined,
            returnedAt: iso(values.get("returnedAt")),
            lines: [
              {
                goodsReceiptLineId: String(values.get("goodsReceiptLineId")),
                returnedQuantityMicros: String(
                  values.get("returnedQuantityMicros"),
                ),
              },
            ],
            reason: String(values.get("reason")),
          }),
        "Purchase return posted with a compensating stock entry.",
      )
    )
      form.reset();
  }

  if (status !== "ready" || !data) {
    return (
      <section className="live-panel live-panel--state">
        <strong>
          {status === "loading"
            ? "Loading procurement…"
            : "Procurement unavailable"}
        </strong>
        <p>{message || "Loading protected branch procurement records."}</p>
        {status === "error" ? (
          <button onClick={() => void load()}>Try again</button>
        ) : null}
      </section>
    );
  }

  const receivableOrders = data.orders.filter((order) =>
    ["SUBMITTED", "PARTIALLY_RECEIVED"].includes(order.status),
  );

  return (
    <section className="live-page procurement-page">
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Purchasing and stock intake</p>
          <h1>Procurement</h1>
          <p>
            Retain supplier terms, exact purchase quantities, receipts and
            returns.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          Refresh procurement
        </button>
      </header>

      <section className="live-metrics">
        <article>
          <span>Suppliers</span>
          <strong>{data.suppliers.length}</strong>
        </article>
        <article>
          <span>Open orders</span>
          <strong>
            {
              data.orders.filter(
                (order) => !["COMPLETED", "CANCELLED"].includes(order.status),
              ).length
            }
          </strong>
        </article>
        <article>
          <span>Receipts</span>
          <strong>{data.receipts.length}</strong>
        </article>
        <article>
          <span>Returns</span>
          <strong>{data.returns.length}</strong>
        </article>
      </section>

      <nav className="live-tabs" aria-label="Procurement dataset">
        {(
          ["suppliers", "orders", "receipts", "returns", "valuation"] as const
        ).map((name) => (
          <button
            key={name}
            className={view === name ? "is-active" : ""}
            onClick={() => setView(name)}
          >
            {name === "valuation"
              ? "Valuation preview"
              : `${name[0]?.toUpperCase()}${name.slice(1)}`}
          </button>
        ))}
      </nav>

      {view === "suppliers" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-panel__title">
              <div>
                <p className="live-eyebrow">Configured sources</p>
                <h2>Suppliers and purchase units</h2>
              </div>
              <span>{supplierItems.length} linked items</span>
            </div>
            <div className="live-card-list">
              {data.suppliers.map((supplier) => (
                <article key={supplier.id} className="live-record-card">
                  <div>
                    <strong>{supplier.name}</strong>
                    <span className="live-status">
                      {supplier.externalKey} · r{supplier.revision}
                    </span>
                  </div>
                  <p>
                    {supplier.paymentTerms || "Payment terms not recorded"}
                    {supplier.leadTimeDays === null
                      ? ""
                      : ` · ${supplier.leadTimeDays} day lead`}
                  </p>
                  {supplier.items.length ? (
                    <ul>
                      {supplier.items.map((item) => (
                        <li key={item.id}>
                          {item.inventoryItem.name} · {item.purchaseUnit.code}
                          {item.supplierSku ? ` · ${item.supplierSku}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="live-empty">No purchase items linked.</p>
                  )}
                </article>
              ))}
              {!data.suppliers.length ? (
                <p className="live-empty">No suppliers configured.</p>
              ) : null}
            </div>
          </article>
          <aside className="inventory-admin-actions">
            {canConfigure ? (
              <>
                <article className="live-panel">
                  <p className="live-eyebrow">Branch supplier</p>
                  <h2>Create supplier</h2>
                  <form className="live-form" onSubmit={supplierCreate}>
                    <input
                      name="externalKey"
                      placeholder="External key"
                      required
                    />
                    <input name="name" placeholder="Supplier name" required />
                    <input
                      name="contactName"
                      placeholder="Contact name (optional)"
                    />
                    <input name="phone" placeholder="Phone (optional)" />
                    <input
                      name="email"
                      type="email"
                      placeholder="Email (optional)"
                    />
                    <input
                      name="paymentTerms"
                      placeholder="Payment terms (optional)"
                    />
                    <input
                      name="leadTimeDays"
                      type="number"
                      min="0"
                      max="365"
                      placeholder="Lead time days"
                    />
                    <input
                      name="reason"
                      placeholder="Reason"
                      required
                      minLength={3}
                    />
                    <button className="live-primary" disabled={busy}>
                      Create supplier
                    </button>
                  </form>
                </article>
                <article className="live-panel">
                  <p className="live-eyebrow">Exact purchasing unit</p>
                  <h2>Link supplier item</h2>
                  <form className="live-form" onSubmit={supplierItemCreate}>
                    <select name="supplierId" required>
                      <option value="">Supplier</option>
                      {data.suppliers
                        .filter((supplier) => supplier.isActive)
                        .map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                    </select>
                    <select name="inventoryItemId" required>
                      <option value="">Inventory item</option>
                      {data.items
                        .filter((item) => item.isActive)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                    <select name="purchaseUnitId" required>
                      <option value="">Purchase unit</option>
                      {data.units
                        .filter((unit) => unit.isActive)
                        .map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name} ({unit.code})
                          </option>
                        ))}
                    </select>
                    <input
                      name="supplierSku"
                      placeholder="Supplier SKU (optional)"
                    />
                    <input
                      name="reason"
                      placeholder="Reason"
                      required
                      minLength={3}
                    />
                    <button className="live-primary" disabled={busy}>
                      Link supplier item
                    </button>
                  </form>
                </article>
              </>
            ) : (
              <div className="live-blocker">
                <strong>Configuration permission required</strong>
                <p>Supplier setup needs procurement.configure.</p>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {view === "orders" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-panel__title">
              <div>
                <p className="live-eyebrow">Revisioned purchasing</p>
                <h2>Purchase orders</h2>
              </div>
              <span>{data.orders.length} retained</span>
            </div>
            <div className="live-card-list">
              {data.orders.map((order) => (
                <article key={order.id} className="live-record-card">
                  <div>
                    <strong>{order.clientReference}</strong>
                    <span
                      className={`live-status live-status--${order.status.toLowerCase()}`}
                    >
                      {order.status} · r{order.revision}
                    </span>
                  </div>
                  <p>
                    {order.supplier.name} ·{" "}
                    {formatMoney(order.totalCostMinor, order.currency)} ·
                    created by {order.createdByDisplayName}
                  </p>
                  <ul>
                    {order.lines.map((line) => (
                      <li key={line.id}>
                        {line.inventoryItemName}:{" "}
                        {formatMicros(
                          line.orderedQuantityMicros,
                          line.purchaseUnitCode,
                        )}{" "}
                        at {formatMoney(line.unitCostMinor, order.currency)}
                      </li>
                    ))}
                  </ul>
                  {order.status === "DRAFT" && canWrite ? (
                    <form
                      className="live-inline-form"
                      onSubmit={(event) =>
                        void orderTransition(event, order, "submit")
                      }
                    >
                      <input
                        name="reason"
                        aria-label={`Submit reason ${order.clientReference}`}
                        placeholder="Submission reason"
                        required
                        minLength={3}
                      />
                      <button disabled={busy}>Submit</button>
                    </form>
                  ) : null}
                  {["DRAFT", "SUBMITTED"].includes(order.status) &&
                  canManage ? (
                    <form
                      className="live-inline-form"
                      onSubmit={(event) =>
                        void orderTransition(event, order, "cancel")
                      }
                    >
                      <input
                        name="reason"
                        aria-label={`Cancel reason ${order.clientReference}`}
                        placeholder="Cancellation reason"
                        required
                        minLength={3}
                      />
                      <button disabled={busy}>Cancel</button>
                    </form>
                  ) : null}
                </article>
              ))}
              {!data.orders.length ? (
                <p className="live-empty">No purchase orders retained.</p>
              ) : null}
            </div>
          </article>
          <aside className="inventory-admin-actions">
            {canWrite ? (
              <article className="live-panel">
                <p className="live-eyebrow">Snapshot cost and quantity</p>
                <h2>Create draft order</h2>
                <form className="live-form" onSubmit={orderCreate}>
                  <select name="supplierItemId" required>
                    <option value="">Supplier item</option>
                    {data.suppliers.flatMap((supplier) =>
                      supplier.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {supplier.name} · {item.inventoryItem.name} (
                          {item.purchaseUnit.code})
                        </option>
                      )),
                    )}
                  </select>
                  <input
                    name="clientReference"
                    placeholder="Client reference"
                    required
                  />
                  <label>
                    Expected at
                    <input name="expectedAt" type="datetime-local" />
                  </label>
                  <input
                    name="quantityMicros"
                    inputMode="numeric"
                    placeholder="Quantity in purchase-unit micros"
                    required
                  />
                  <input
                    name="unitCostMinor"
                    type="number"
                    min="0"
                    placeholder="Unit cost in pesewas"
                    required
                  />
                  <input
                    name="reason"
                    placeholder="Reason"
                    required
                    minLength={3}
                  />
                  <button
                    className="live-primary"
                    disabled={busy || !supplierItems.length}
                  >
                    Create draft order
                  </button>
                </form>
              </article>
            ) : (
              <div className="live-blocker">
                <strong>Write permission required</strong>
                <p>Order creation needs procurement.write.</p>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {view === "receipts" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-panel__title">
              <div>
                <p className="live-eyebrow">Posted stock intake</p>
                <h2>Goods receipts</h2>
              </div>
              <span>{data.receipts.length} retained</span>
            </div>
            <div className="live-card-list">
              {data.receipts.map((receipt) => (
                <article key={receipt.id} className="live-record-card">
                  <div>
                    <strong>{receipt.supplier.name}</strong>
                    <span className="live-status">
                      {formatMoney(receipt.totalCostMinor, receipt.currency)}
                    </span>
                  </div>
                  <p>
                    {new Date(receipt.receivedAt).toLocaleString()} by{" "}
                    {receipt.postedByDisplayName}
                  </p>
                  <ul>
                    {receipt.lines.map((line) => (
                      <li key={line.id}>
                        {formatMicros(line.receivedQuantityMicros)} purchase
                        micros · {formatMicros(line.receivedBaseMicros)} base
                        micros
                        {line.lotReference ? ` · lot ${line.lotReference}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p>{receipt.reason}</p>
                </article>
              ))}
              {!data.receipts.length ? (
                <p className="live-empty">No goods receipts posted.</p>
              ) : null}
            </div>
          </article>
          <aside className="inventory-admin-actions">
            {canWrite ? (
              <article className="live-panel">
                <p className="live-eyebrow">Append stock intake</p>
                <h2>Receive order line</h2>
                <form className="live-form" onSubmit={receiptPost}>
                  <select name="orderId" required>
                    <option value="">Submitted order</option>
                    {receivableOrders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.clientReference} · {order.supplier.name}
                      </option>
                    ))}
                  </select>
                  <select name="purchaseOrderLineId" required>
                    <option value="">Order line</option>
                    {receivableOrders.flatMap((order) =>
                      order.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {order.clientReference} · {line.inventoryItemName}
                        </option>
                      )),
                    )}
                  </select>
                  <select name="locationId" required>
                    <option value="">Receiving location</option>
                    {data.locations
                      .filter((location) => location.isActive)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                  </select>
                  <label>
                    Received at
                    <input name="receivedAt" type="datetime-local" required />
                  </label>
                  <input
                    name="receivedQuantityMicros"
                    inputMode="numeric"
                    placeholder="Received purchase-unit micros"
                    required
                  />
                  <input
                    name="supplierDocumentReference"
                    placeholder="Supplier document (optional)"
                  />
                  <input
                    name="lotReference"
                    placeholder="Lot reference (optional)"
                  />
                  <label>
                    Expires on
                    <input name="expiresOn" type="date" />
                  </label>
                  <input
                    name="reason"
                    placeholder="Reason"
                    required
                    minLength={3}
                  />
                  <button
                    className="live-primary"
                    disabled={busy || !receivableOrders.length}
                  >
                    Post goods receipt
                  </button>
                </form>
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}

      {view === "returns" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-panel__title">
              <div>
                <p className="live-eyebrow">Compensating stock history</p>
                <h2>Purchase returns</h2>
              </div>
              <span>{data.returns.length} retained</span>
            </div>
            <div className="live-card-list">
              {data.returns.map((returned) => (
                <article key={returned.id} className="live-record-card">
                  <div>
                    <strong>{returned.supplier.name}</strong>
                    <span className="live-status">
                      {formatMoney(returned.totalCostMinor, returned.currency)}
                    </span>
                  </div>
                  <p>
                    {new Date(returned.returnedAt).toLocaleString()} by{" "}
                    {returned.postedByDisplayName}
                  </p>
                  <ul>
                    {returned.lines.map((line) => (
                      <li key={line.id}>
                        {formatMicros(line.returnedQuantityMicros)} purchase
                        micros · {formatMicros(line.returnedBaseMicros)} base
                        micros
                      </li>
                    ))}
                  </ul>
                  <p>{returned.reason}</p>
                </article>
              ))}
              {!data.returns.length ? (
                <p className="live-empty">No purchase returns posted.</p>
              ) : null}
            </div>
          </article>
          <aside className="inventory-admin-actions">
            {canWrite ? (
              <article className="live-panel">
                <p className="live-eyebrow">Negative override disabled</p>
                <h2>Return receipt line</h2>
                <form className="live-form" onSubmit={returnPost}>
                  <select name="receiptId" required>
                    <option value="">Goods receipt</option>
                    {data.receipts.map((receipt) => (
                      <option key={receipt.id} value={receipt.id}>
                        {receipt.supplier.name} ·{" "}
                        {new Date(receipt.receivedAt).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                  <select name="goodsReceiptLineId" required>
                    <option value="">Receipt line</option>
                    {data.receipts.flatMap((receipt) =>
                      receipt.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {receipt.supplier.name} ·{" "}
                          {formatMicros(line.receivedQuantityMicros)}
                        </option>
                      )),
                    )}
                  </select>
                  <label>
                    Returned at
                    <input name="returnedAt" type="datetime-local" required />
                  </label>
                  <input
                    name="returnedQuantityMicros"
                    inputMode="numeric"
                    placeholder="Returned purchase-unit micros"
                    required
                  />
                  <input
                    name="supplierDocumentReference"
                    placeholder="Return document (optional)"
                  />
                  <input
                    name="reason"
                    placeholder="Reason"
                    required
                    minLength={3}
                  />
                  <button
                    className="live-primary"
                    disabled={busy || !data.receipts.length}
                  >
                    Post purchase return
                  </button>
                </form>
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}

      {view === "valuation" ? (
        <article className="live-panel">
          <div className="live-blocker">
            <strong>Official inventory valuation remains disabled</strong>
            <p>
              {data.valuation.configurationIssue}. This preview shows net
              receipt cost evidence only; no FIFO, weighted-average or
              accounting claim is made.
            </p>
          </div>
          <div className="live-panel__title">
            <div>
              <p className="live-eyebrow">{data.valuation.basis}</p>
              <h2>Provisional receipt-cost evidence</h2>
            </div>
            <span>
              Generated {new Date(data.valuation.generatedAt).toLocaleString()}
            </span>
          </div>
          <div className="live-table-wrap">
            <table className="live-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Item</th>
                  <th>Balance micros</th>
                  <th>Net received micros</th>
                  <th>Net receipt cost</th>
                </tr>
              </thead>
              <tbody>
                {data.valuation.rows.map((row) => (
                  <tr key={`${row.locationId}:${row.inventoryItemId}`}>
                    <td>
                      {data.locations.find(
                        (entry) => entry.id === row.locationId,
                      )?.name ?? row.locationId}
                    </td>
                    <td>
                      {data.items.find(
                        (entry) => entry.id === row.inventoryItemId,
                      )?.name ?? row.inventoryItemId}
                    </td>
                    <td>{row.quantityMicros}</td>
                    <td>{row.netReceivedBaseMicros}</td>
                    <td>
                      {row.netReceivedCostMinor} {data.valuation.currency} minor
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
    </section>
  );
}
