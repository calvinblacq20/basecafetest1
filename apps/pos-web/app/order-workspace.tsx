"use client";

import type {
  OrderListItemResponse,
  OrderOperationDetailResponse,
  SyncBootstrapResponse,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { Icon } from "@base-cafe/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";

type Operation = "MOVE" | "TRANSFER" | "MERGE" | "SPLIT";

type Props = {
  runtime: CashierRuntime;
  tables: SyncBootstrapResponse["tables"];
  deviceOrderIds: readonly string[];
  onOpenDeviceOrder(orderId: string): void;
  onReviewPayments(order: {
    id: string;
    orderNumber: string;
    grossTotalMinor: number;
  }): void;
  onRefreshBootstrap(): Promise<void>;
};

const channelLabels = {
  DINE_IN: "Dine in",
  TAKEAWAY: "Takeaway",
  PHONE_DELIVERY: "Delivery",
  BAR_TAB: "Bar tab",
} as const;

function errorMessage(error: unknown) {
  const code =
    error instanceof Error ? error.message : "ORDER_OPERATION_FAILED";
  const messages: Record<string, string> = {
    STALE_REVISION: "This order changed. The latest revision has been loaded.",
    TABLE_OCCUPIED:
      "That table is occupied. A manager may retry with conflict override.",
    ORDER_MERGE_INCOMPATIBLE:
      "Only open orders from the same shift, channel, date and tax profile can merge.",
    ORDER_OPERATION_REQUIRES_CONNECTION:
      "Manager order operations require an online connection.",
    ORDER_LIST_REQUIRES_CONNECTION:
      "The branch order workspace requires an online connection.",
  };
  return messages[code] ?? code.replaceAll("_", " ");
}

function serviceReference(order: OrderListItemResponse) {
  return (
    order.table?.name ??
    order.tabName ??
    order.pickupReference ??
    order.customerReference ??
    channelLabels[order.channel]
  );
}

function ageLabel(createdAt: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(createdAt)) / 60_000),
  );
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function OrderWorkspace({
  runtime,
  tables,
  deviceOrderIds,
  onOpenDeviceOrder,
  onReviewPayments,
  onRefreshBootstrap,
}: Props) {
  const [orders, setOrders] = useState<OrderListItemResponse[]>([]);
  const [status, setStatus] = useState<"OPEN" | "HELD">("OPEN");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderOperationDetailResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const permissions = runtime.session.user.permissions;

  const load = useCallback(
    async (preferredId?: string | null) => {
      setLoading(true);
      try {
        const [open, held] = await Promise.all([
          runtime.listBranchOrders("OPEN"),
          runtime.listBranchOrders("HELD"),
        ]);
        const all = [...open, ...held];
        setOrders(all);
        const nextId = preferredId ?? selectedId;
        if (nextId && all.some((order) => order.id === nextId)) {
          setSelectedId(nextId);
          setDetail(await runtime.getOrderForOperations(nextId));
        } else {
          const first = all.find((order) => order.status === status) ?? all[0];
          setSelectedId(first?.id ?? null);
          setDetail(
            first ? await runtime.getOrderForOperations(first.id) : null,
          );
        }
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [runtime, selectedId, status],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Runtime replacement is the only automatic reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return orders.filter(
      (order) =>
        order.status === status &&
        (!normalized ||
          `${order.orderNumber} ${order.clientReference} ${serviceReference(order)} ${order.assignedServer.displayName}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [orders, query, status]);

  async function select(orderId: string) {
    setSelectedId(orderId);
    setLoading(true);
    try {
      setDetail(await runtime.getOrderForOperations(orderId));
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function afterOperation(message: string) {
    setOperation(null);
    await onRefreshBootstrap();
    await load(selectedId);
    setNotice(message);
  }

  return (
    <section className="orders-workspace" aria-label="Branch orders">
      <div className="orders-workspace__header">
        <div>
          <h1>Orders</h1>
          <p>Live branch orders · manager changes retain immutable history</p>
        </div>
        <button
          aria-label="Refresh branch orders"
          className="orders-refresh"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <Icon name="recall" size={19} />
          Refresh
        </button>
      </div>

      <div className="orders-tabs" role="tablist" aria-label="Order status">
        {(["OPEN", "HELD"] as const).map((value) => (
          <button
            aria-selected={status === value}
            className={status === value ? "is-active" : ""}
            key={value}
            onClick={() => {
              setStatus(value);
              const first = orders.find((order) => order.status === value);
              if (first) void select(first.id);
              else {
                setSelectedId(null);
                setDetail(null);
              }
            }}
            role="tab"
            type="button"
          >
            {value === "OPEN" ? "Open" : "Held"}
            <span>
              {orders.filter((order) => order.status === value).length}
            </span>
          </button>
        ))}
      </div>

      <label className="orders-search">
        <Icon name="search" size={20} />
        <input
          aria-label="Search orders"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search orders"
          type="search"
          value={query}
        />
      </label>

      <div className="orders-layout">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Type</th>
                <th>Table / reference</th>
                <th>Age</th>
                <th>Total</th>
                <th>Staff</th>
                <th aria-label="Open details" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr
                  aria-selected={selectedId === entry.id}
                  className={selectedId === entry.id ? "is-selected" : ""}
                  key={entry.id}
                  onClick={() => void select(entry.id)}
                >
                  <td>
                    <strong>{entry.orderNumber}</strong>
                    <small>{entry.activeLineCount} item lines</small>
                  </td>
                  <td>{channelLabels[entry.channel]}</td>
                  <td>{serviceReference(entry)}</td>
                  <td>{ageLabel(entry.createdAt)}</td>
                  <td>{formatMoney(money(entry.grossTotalMinor))}</td>
                  <td>{entry.assignedServer.displayName}</td>
                  <td>
                    <Icon name="chevron" size={18} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && visible.length === 0 ? (
            <div className="orders-empty">
              <Icon name="orders" size={30} />
              <strong>No {status.toLocaleLowerCase()} orders</strong>
              <span>Try the other status or clear the search.</span>
            </div>
          ) : null}
        </div>

        <aside className="order-operation-panel" aria-label="Order details">
          {detail ? (
            <>
              <div className="operation-panel__heading">
                <div>
                  <small>Order details</small>
                  <h2>{detail.orderNumber}</h2>
                </div>
                <span data-status={detail.status}>{detail.status}</span>
              </div>
              <dl className="operation-facts">
                <div>
                  <dt>Type</dt>
                  <dd>{channelLabels[detail.channel]}</dd>
                </div>
                <div>
                  <dt>Table</dt>
                  <dd>{detail.table?.name ?? "Not attached"}</dd>
                </div>
                <div>
                  <dt>Staff</dt>
                  <dd>{detail.assignedServer.displayName}</dd>
                </div>
                <div>
                  <dt>Items</dt>
                  <dd>
                    {
                      detail.lines.filter((line) => line.status === "DRAFT")
                        .length
                    }
                  </dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{formatMoney(money(detail.grossTotalMinor))}</dd>
                </div>
              </dl>
              <div className="operation-actions">
                {permissions.includes("payments.read") ? (
                  <button
                    onClick={() => onReviewPayments(detail)}
                    type="button"
                  >
                    <Icon name="card" size={20} /> Payments{" "}
                    <Icon name="chevron" size={17} />
                  </button>
                ) : null}
                {permissions.includes("orders.table.move") &&
                ["DINE_IN", "BAR_TAB"].includes(detail.channel) ? (
                  <button onClick={() => setOperation("MOVE")} type="button">
                    <Icon name="table" size={20} /> Move table{" "}
                    <Icon name="chevron" size={17} />
                  </button>
                ) : null}
                {permissions.includes("orders.owner.transfer") ? (
                  <button
                    onClick={() => setOperation("TRANSFER")}
                    type="button"
                  >
                    <Icon name="users" size={20} /> Transfer responsibility{" "}
                    <Icon name="chevron" size={17} />
                  </button>
                ) : null}
                {permissions.includes("orders.split-merge") &&
                detail.status === "OPEN" ? (
                  <>
                    <button onClick={() => setOperation("MERGE")} type="button">
                      <Icon name="plus" size={20} /> Merge orders{" "}
                      <Icon name="chevron" size={17} />
                    </button>
                    {detail.lines.some(
                      (line) => line.status === "DRAFT" && !line.sentAt,
                    ) ? (
                      <button
                        onClick={() => setOperation("SPLIT")}
                        type="button"
                      >
                        <Icon name="minus" size={20} /> Split order{" "}
                        <Icon name="chevron" size={17} />
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              {deviceOrderIds.includes(detail.id) ? (
                <button
                  className="open-in-sell"
                  onClick={() => onOpenDeviceOrder(detail.id)}
                  type="button"
                >
                  Open in sell
                </button>
              ) : (
                <p className="operation-device-note">
                  This order belongs to another enrolled device. Manager
                  operations remain available here.
                </p>
              )}
            </>
          ) : (
            <div className="orders-empty">
              <strong>Select an order</strong>
            </div>
          )}
        </aside>
      </div>

      {operation && detail ? (
        <OrderOperationDialog
          allowConflictOverride={permissions.includes("orders.manage")}
          detail={detail}
          operation={operation}
          orders={orders}
          runtime={runtime}
          tables={tables}
          onClose={() => setOperation(null)}
          onComplete={afterOperation}
          onStale={() => load(selectedId)}
        />
      ) : null}
      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss message"
            onClick={() => setNotice(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function OrderOperationDialog({
  operation,
  detail,
  orders,
  tables,
  runtime,
  allowConflictOverride,
  onClose,
  onComplete,
  onStale,
}: {
  operation: Operation;
  detail: OrderOperationDetailResponse;
  orders: readonly OrderListItemResponse[];
  tables: SyncBootstrapResponse["tables"];
  runtime: CashierRuntime;
  allowConflictOverride: boolean;
  onClose(): void;
  onComplete(message: string): Promise<void>;
  onStale(): Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [allowConflict, setAllowConflict] = useState(false);
  const [staff, setStaff] = useState<{ id: string; displayName: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftLines = detail.lines.filter(
    (line) => line.status === "DRAFT" && !line.sentAt,
  );
  const selectedLine = draftLines.find((line) => line.id === targetId);
  const mergeCandidates = orders.filter(
    (order) =>
      order.id !== detail.id &&
      order.status === "OPEN" &&
      order.channel === detail.channel,
  );

  useEffect(() => {
    if (operation !== "TRANSFER") return;
    void runtime
      .orderOperationOptions()
      .then((response) => setStaff(response.staff))
      .catch((cause) => setError(errorMessage(cause)));
  }, [operation, runtime]);

  async function submit() {
    if (!reason.trim() || !targetId) return;
    setBusy(true);
    setError(null);
    try {
      if (operation === "MOVE")
        await runtime.moveOrderTable(
          detail,
          targetId === "DETACH" ? null : targetId,
          allowConflict,
          reason,
        );
      if (operation === "TRANSFER")
        await runtime.transferOrderResponsibility(detail, targetId, reason);
      if (operation === "MERGE") {
        const source = mergeCandidates.find((order) => order.id === targetId);
        if (!source) throw new Error("ORDER_MERGE_SOURCE_REQUIRED");
        await runtime.mergeOrder(detail, source, reason);
      }
      if (operation === "SPLIT") {
        if (!selectedLine) throw new Error("ORDER_SPLIT_LINE_REQUIRED");
        await runtime.splitOrderLine(detail, selectedLine, quantity, reason);
      }
      await onComplete(
        operation === "MOVE"
          ? "Table movement recorded"
          : operation === "TRANSFER"
            ? "Responsibility transfer recorded"
            : operation === "MERGE"
              ? "Orders merged with retained lineage"
              : "Split child order created",
      );
    } catch (cause) {
      const value = errorMessage(cause);
      setError(value);
      if (cause instanceof Error && cause.message === "STALE_REVISION")
        await onStale();
    } finally {
      setBusy(false);
    }
  }

  const labels = {
    MOVE: ["Move table", "Choose the destination table or detach the order."],
    TRANSFER: [
      "Transfer responsibility",
      "Choose the active staff member receiving this order.",
    ],
    MERGE: [
      "Merge orders",
      "The source becomes retained history under this target order.",
    ],
    SPLIT: [
      "Split order",
      "Move an unsent line quantity into a new numbered order.",
    ],
  } as const;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="order-operation-title"
        aria-modal="true"
        className="dialog operation-dialog"
        role="dialog"
      >
        <div className="dialog__heading">
          <div>
            <h2 id="order-operation-title">{labels[operation][0]}</h2>
            <p>{labels[operation][1]}</p>
          </div>
          <button aria-label="Close" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <label>
          {operation === "MOVE"
            ? "Destination"
            : operation === "TRANSFER"
              ? "Receiving staff"
              : operation === "MERGE"
                ? "Source order"
                : "Draft line"}
          <select
            onChange={(event) => {
              setTargetId(event.target.value);
              setQuantity(1);
            }}
            value={targetId}
          >
            <option value="">Select…</option>
            {operation === "MOVE" ? (
              <option value="DETACH">Detach from table</option>
            ) : null}
            {operation === "MOVE"
              ? tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.areaName} · {table.name}
                  </option>
                ))
              : null}
            {operation === "TRANSFER"
              ? staff
                  .filter((entry) => entry.id !== detail.assignedServer.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName}
                    </option>
                  ))
              : null}
            {operation === "MERGE"
              ? mergeCandidates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.orderNumber} · {serviceReference(entry)}
                  </option>
                ))
              : null}
            {operation === "SPLIT"
              ? draftLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.quantity} × {line.itemNameSnapshot}
                    {line.variantNameSnapshot
                      ? ` · ${line.variantNameSnapshot}`
                      : ""}
                  </option>
                ))
              : null}
          </select>
        </label>
        {operation === "SPLIT" && selectedLine ? (
          <label>
            Quantity to split
            <input
              max={selectedLine.quantity}
              min={1}
              onChange={(event) => setQuantity(Number(event.target.value))}
              type="number"
              value={quantity}
            />
          </label>
        ) : null}
        {operation === "MOVE" && allowConflictOverride ? (
          <label className="dialog-check">
            <input
              checked={allowConflict}
              onChange={(event) => setAllowConflict(event.target.checked)}
              type="checkbox"
            />{" "}
            Allow occupied-table override if required
          </label>
        ) : null}
        <label>
          Reason required
          <textarea
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="State the operational reason"
            rows={3}
            value={reason}
          />
        </label>
        <p className="revision-warning">
          This action creates a new revision. Previous history remains available
          for audit.
        </p>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="button button--outline"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button"
            disabled={
              busy ||
              !targetId ||
              !reason.trim() ||
              (operation === "SPLIT" &&
                (!selectedLine ||
                  quantity < 1 ||
                  quantity > selectedLine.quantity))
            }
            onClick={() => void submit()}
            type="button"
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
