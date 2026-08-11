"use client";

import type {
  OrderChannel,
  ReceiptResponse,
  SyncBootstrapResponse,
} from "@base-cafe/contracts";
import { formatMoney, money } from "@base-cafe/domain";
import { Brand, Icon, type IconName } from "@base-cafe/ui";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DeviceLogin } from "./device-login";
import { CashControlWorkspace } from "./cash-control-workspace";
import { OrderWorkspace } from "./order-workspace";
import { RefundWorkspace } from "./refund-workspace";
import { ReceiptWorkspace } from "./receipt-workspace";
import { RecoveryWorkspace } from "./recovery-workspace";
import type {
  BootstrapResult,
  CashierRuntime,
  CreateWorkingOrderInput,
  LocalLineModifier,
  WorkingOrder,
} from "./offline/cashier-runtime";
import type { LocalSyncSummary } from "./offline/sync-store";
import { SyncIndicator } from "./offline/sync-indicator";
import {
  CreateOrderDialog,
  ModifierDialog,
  OfflineAccessDialog,
  ReceiptDialog,
  ShiftDialog,
  SplitTenderDialog,
  TenderVerificationDialog,
} from "./pos-dialogs";

type CatalogItem = SyncBootstrapResponse["catalog"][number];

const channelOptions: readonly {
  value: OrderChannel;
  label: string;
  icon: IconName;
}[] = [
  { value: "DINE_IN", label: "Dine in", icon: "users" },
  { value: "TAKEAWAY", label: "Takeaway", icon: "bag" },
  { value: "PHONE_DELIVERY", label: "Delivery", icon: "send" },
  { value: "BAR_TAB", label: "Bar tab", icon: "spark" },
];

const EMPTY_SUMMARY: LocalSyncSummary = {
  pending: 0,
  sending: 0,
  synced: 0,
  conflicts: 0,
  failed: 0,
  resolved: 0,
  lastSuccessfulSyncAt: null,
};

function message(error: unknown) {
  const value = error instanceof Error ? error.message : "POS_ACTION_FAILED";
  const messages: Record<string, string> = {
    ORDER_SHIFT_NOT_OPEN: "Open a device shift before creating an order.",
    TAX_CONFIGURATION_MISSING:
      "An approved active tax profile is required before selling.",
    SENT_LINE_IMMUTABLE:
      "Sent lines are immutable. Use the controlled cancellation workflow.",
    ORDER_NOT_WRITABLE: "Resume the held order before changing it.",
    NO_DRAFT_LINES: "There are no new draft lines to send.",
    ORDER_COMPLETE_REQUIRES_SYNC:
      "Synchronize this order before completing the sale.",
    ORDER_PREPARATION_INCOMPLETE:
      "Kitchen or bar preparation must be completed first.",
    ORDER_PAYMENT_INCOMPLETE: "The full confirmed payment is still required.",
    SYNC_REQUIRES_REVIEW:
      "A local conflict or failed command needs manager review.",
  };
  return messages[value] ?? value.replaceAll("_", " ");
}

export function PosShell() {
  const [runtime, setRuntime] = useState<CashierRuntime | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState<string>();
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null);
  const [order, setOrder] = useState<WorkingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [channel, setChannel] = useState<OrderChannel>("DINE_IN");
  const [modifierItem, setModifierItem] = useState<CatalogItem | null>(null);
  const [pendingItem, setPendingItem] = useState<{
    item: CatalogItem;
    modifiers: LocalLineModifier[];
  } | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentReview, setPaymentReview] = useState<{
    id: string;
    orderNumber: string;
    grossTotalMinor: number;
  } | null>(null);
  const [receipt, setReceipt] = useState<{
    record: ReceiptResponse;
    html: string;
  } | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftSummary, setShiftSummary] = useState(EMPTY_SUMMARY);
  const [offlineAccessOpen, setOfflineAccessOpen] = useState(false);
  const [offlineAccessEnrolled, setOfflineAccessEnrolled] = useState(false);
  const [activeView, setActiveView] = useState<
    "SELL" | "ORDERS" | "REFUNDS" | "CASH" | "RECEIPTS" | "RECOVERY"
  >("SELL");
  const deferredQuery = useDeferredValue(query);

  const activateRuntime = useCallback(async (next: CashierRuntime) => {
    setRuntime(next);
    setLoading(true);
    try {
      const browser = await import("./offline/browser-runtime");
      setOfflineAccessEnrolled(browser.getOfflineUnlockStatus().available);
      const data = await next.bootstrap();
      setBootstrap(data);
      setChannel(data.data.orders[0]?.channel ?? "DINE_IN");
      setOrder(await next.currentOrder());
    } catch (error) {
      setNotice(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void import("./offline/browser-runtime").then(async (browser) => {
      void browser.registerOfflineShell();
      const profile = browser.getStoredSessionProfile();
      if (active) setRememberedEmail(profile?.user.email);
      const restored = browser.getBrowserCashierRuntime();
      if (active && restored) await activateRuntime(restored);
      else if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activateRuntime]);

  useEffect(() => {
    const unauthorized = async () => {
      const { logoutBrowserDevice } = await import("./offline/browser-runtime");
      await logoutBrowserDevice();
      setRuntime(null);
      setBootstrap(null);
      setOrder(null);
      setNotice("Your session expired. Sign in again.");
    };
    window.addEventListener("base-cafe:pos-unauthorized", unauthorized);
    return () =>
      window.removeEventListener("base-cafe:pos-unauthorized", unauthorized);
  }, []);

  const categories = useMemo(
    () => [
      "All",
      ...new Set(
        bootstrap?.data.catalog.map((item) => item.categoryName) ?? [],
      ),
    ],
    [bootstrap],
  );
  const visibleItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return (bootstrap?.data.catalog ?? []).filter(
      (item) =>
        (category === "All" || item.categoryName === category) &&
        (!normalized ||
          `${item.name} ${item.variantName ?? ""} ${item.categoryName}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [bootstrap, category, deferredQuery]);

  async function action(work: () => Promise<WorkingOrder>, success: string) {
    setBusy(true);
    try {
      const next = await work();
      setOrder(next);
      setNotice(success);
      void runtime?.engine.flush();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function addItem(
    item: CatalogItem,
    modifiers: LocalLineModifier[] = [],
  ) {
    if (!runtime) return;
    const current = order;
    if (!current) {
      setPendingItem({ item, modifiers });
      setCreateOrderOpen(true);
      return;
    }
    await action(
      () => runtime.addLine(current!, item, modifiers),
      `${item.name} queued`,
    );
  }

  async function refreshBootstrap() {
    if (!runtime) return;
    setBusy(true);
    try {
      const next = await runtime.bootstrap();
      setBootstrap(next);
      setOrder(await runtime.currentOrder());
      setNotice(
        next.source === "NETWORK"
          ? "Working data refreshed"
          : "Using cached working data",
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function createOrder(input: CreateWorkingOrderInput) {
    if (!runtime) return;
    const created = await runtime.createOrder(input);
    const next = pendingItem
      ? await runtime.addLine(created, pendingItem.item, pendingItem.modifiers)
      : created;
    setOrder(next);
    setChannel(input.channel);
    setPendingItem(null);
    setCreateOrderOpen(false);
    setNotice("Order saved locally and queued for sync");
    void runtime.engine.flush();
  }

  async function synchronizeSale() {
    if (!runtime || !order) return;
    setBusy(true);
    try {
      const result = await runtime.synchronize(order.id);
      setBootstrap(result.bootstrap);
      setOrder(result.order);
      setNotice("Order, payment and kitchen state refreshed");
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function completeSale() {
    if (!runtime || !order) return;
    setBusy(true);
    try {
      const synchronized = await runtime.synchronize(order.id);
      if (!synchronized.order) throw new Error("ORDER_NOT_FOUND");
      const completion = await runtime.complete(synchronized.order);
      const record = await runtime.createReceipt(
        completion.orderId,
        completion.revision,
      );
      const html = await runtime.renderReceipt(record);
      setReceipt({ record, html });
      setOrder(null);
      setBootstrap(await runtime.bootstrap());
      setNotice(`Sale completed · ${record.receiptNumber}`);
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="pos-loading">
        <Brand />
        <strong>Restoring this device…</strong>
      </main>
    );
  }

  if (!runtime) {
    return (
      <DeviceLogin
        rememberedEmail={rememberedEmail}
        onAuthenticated={(next) => void activateRuntime(next)}
      />
    );
  }

  const session = runtime.session;
  const data = bootstrap?.data;
  const canManage = session.user.permissions.includes("sync.recovery.manage");
  const draftLines = order?.lines.filter((line) => !line.sent) ?? [];

  return (
    <main className={activeView === "SELL" ? "pos-app" : "pos-app is-orders"}>
      <header className="topbar">
        <Brand />
        <button
          className="branch-select"
          onClick={() => void refreshBootstrap()}
          type="button"
        >
          <Icon name="grid" size={20} />
          <span>{data?.branch.name ?? "Branch unavailable"}</span>
          <Icon name="recall" size={18} />
        </button>
        <label className="orders-select">
          <Icon name="orders" size={20} />
          <select
            aria-label="Open device orders"
            onChange={(event) => {
              if (!event.target.value) return setOrder(null);
              setActiveView("SELL");
              void action(
                () => runtime.selectOrder(event.target.value),
                "Order loaded",
              );
            }}
            value={order?.id ?? ""}
          >
            <option value="">Open orders ({data?.orders.length ?? 0})</option>
            {data?.orders.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.orderNumber} ·{" "}
                {entry.tableName ??
                  entry.customerReference ??
                  entry.tabName ??
                  entry.channel}
              </option>
            ))}
          </select>
        </label>
        <div className="topbar__spacer" />
        <SyncIndicator engine={runtime.engine} canManage={canManage} />
        {session.offlineAccess.enabled && !session.offlineUnlocked ? (
          <button
            className="topbar-action"
            onClick={() => setOfflineAccessOpen(true)}
            type="button"
          >
            Offline PIN
          </button>
        ) : null}
        <button
          className="topbar-action"
          onClick={async () => {
            const { lockBrowserDevice } =
              await import("./offline/browser-runtime");
            lockBrowserDevice();
            setRuntime(null);
            setBootstrap(null);
            setOrder(null);
          }}
          type="button"
        >
          Lock
        </button>
        <div className="topbar__divider" />
        <button
          className="user-menu"
          onClick={async () => {
            const { logoutBrowserDevice } =
              await import("./offline/browser-runtime");
            await logoutBrowserDevice();
            setRuntime(null);
            setBootstrap(null);
            setOrder(null);
          }}
          title="Sign out"
          type="button"
        >
          <span className="user-menu__avatar">
            <Icon name="user" size={23} />
          </span>
          <span>
            <strong>{session.user.displayName}</strong>
            <small>
              {data?.shift
                ? `Shift · ${data.shift.businessDate}`
                : "No open shift"}
            </small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      </header>

      <nav className="side-nav" aria-label="POS navigation">
        <div className="side-nav__items">
          {[
            { icon: "bag" as const, label: "Sell" },
            { icon: "table" as const, label: "Tables" },
            { icon: "orders" as const, label: "Orders" },
            ...(session.user.permissions.includes("refunds.read")
              ? [{ icon: "recall" as const, label: "Refunds" }]
              : []),
            ...(session.user.permissions.includes("cash-movements.read")
              ? [{ icon: "shift" as const, label: "Cash" }]
              : []),
            ...(session.user.permissions.includes("receipts.read")
              ? [{ icon: "orders" as const, label: "Receipts" }]
              : []),
            { icon: "wifi" as const, label: "Recovery" },
            { icon: "shift" as const, label: "Shift" },
          ].map((item) => (
            <button
              aria-current={
                (item.label === "Sell" && activeView === "SELL") ||
                (item.label === "Orders" && activeView === "ORDERS") ||
                (item.label === "Refunds" && activeView === "REFUNDS") ||
                (item.label === "Cash" && activeView === "CASH") ||
                (item.label === "Receipts" && activeView === "RECEIPTS") ||
                (item.label === "Recovery" && activeView === "RECOVERY")
                  ? "page"
                  : undefined
              }
              className={
                (item.label === "Sell" && activeView === "SELL") ||
                (item.label === "Orders" && activeView === "ORDERS") ||
                (item.label === "Refunds" && activeView === "REFUNDS") ||
                (item.label === "Cash" && activeView === "CASH") ||
                (item.label === "Receipts" && activeView === "RECEIPTS") ||
                (item.label === "Recovery" && activeView === "RECOVERY")
                  ? "nav-item is-active"
                  : "nav-item"
              }
              key={item.label}
              onClick={async () => {
                if (item.label === "Shift") {
                  setShiftSummary(await runtime.engine.summary());
                  setShiftOpen(true);
                } else if (item.label === "Sell") {
                  setActiveView("SELL");
                } else if (item.label === "Orders") {
                  setActiveView("ORDERS");
                } else if (item.label === "Refunds") {
                  setActiveView("REFUNDS");
                } else if (item.label === "Cash") {
                  setActiveView("CASH");
                } else if (item.label === "Receipts") {
                  setActiveView("RECEIPTS");
                } else if (item.label === "Recovery") {
                  setActiveView("RECOVERY");
                } else {
                  setNotice(
                    `${item.label} remains online-only in this cashier slice`,
                  );
                }
              }}
              type="button"
            >
              <Icon name={item.icon} size={24} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <section className="menu-workspace" aria-label="Menu">
        {session.offlineUnlocked ? (
          <div className="offline-session-banner" role="alert">
            <strong>Offline restart access</strong>
            <span>
              Cached selling is available. Sign in with your password after
              reconnection before any commands can sync.
            </span>
          </div>
        ) : null}
        {bootstrap?.source === "CACHE" ? (
          <div
            className={
              bootstrap.stale ? "offline-banner is-stale" : "offline-banner"
            }
            role="status"
          >
            <Icon name="clock" size={18} />
            <span>
              {bootstrap.stale
                ? "Cached configuration is stale; manager review is recommended."
                : "Working from the last verified device cache."}
            </span>
          </div>
        ) : null}
        {!data?.shift ? (
          <button
            className="configuration-banner"
            onClick={async () => {
              setShiftSummary(await runtime.engine.summary());
              setShiftOpen(true);
            }}
            type="button"
          >
            No open device shift · open Shift to begin
          </button>
        ) : null}
        {!data?.taxProfile ? (
          <div className="configuration-banner" role="alert">
            Tax configuration is missing. New order lines remain blocked.
          </div>
        ) : null}

        <div className="channel-tabs" aria-label="Order channel">
          {channelOptions.map((option) => (
            <button
              aria-pressed={channel === option.value}
              className={channel === option.value ? "is-active" : ""}
              disabled={Boolean(order)}
              key={option.value}
              onClick={() => {
                setChannel(option.value);
                setCreateOrderOpen(true);
              }}
              type="button"
            >
              <Icon name={option.icon} size={21} />
              {option.label}
            </button>
          ))}
        </div>

        <div className="search-row">
          <label className="search-control">
            <Icon name="search" size={23} />
            <input
              aria-label="Search menu"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search verified catalog"
              type="search"
              value={query}
            />
          </label>
          <button
            aria-label="Refresh menu"
            className="filter-button"
            disabled={busy}
            onClick={() => void refreshBootstrap()}
            type="button"
          >
            <Icon name="recall" size={22} />
          </button>
        </div>

        <div className="catalog-layout">
          <div className="category-rail" aria-label="Menu categories">
            {categories.map((value) => (
              <button
                aria-pressed={category === value}
                className={category === value ? "is-active" : ""}
                key={value}
                onClick={() => setCategory(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
          <div className="product-grid" aria-live="polite">
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <button
                  className="product-tile"
                  disabled={
                    busy ||
                    !data?.shift ||
                    !data.taxProfile ||
                    (order?.status !== undefined && order.status !== "OPEN")
                  }
                  key={`${item.menuItemId}:${item.variantId ?? "base"}`}
                  onClick={() =>
                    item.modifierGroups.length > 0
                      ? setModifierItem(item)
                      : void addItem(item)
                  }
                  type="button"
                >
                  <span className="product-tile__image product-tile__monogram">
                    <span>{item.name.slice(0, 2).toUpperCase()}</span>
                    <small>{item.categoryName}</small>
                  </span>
                  <span className="product-tile__body">
                    <strong>{item.name}</strong>
                    {item.variantName ? (
                      <small>{item.variantName}</small>
                    ) : null}
                    <span>{formatMoney(money(item.priceMinor))}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-menu">
                <Icon name="search" size={30} />
                <strong>No sellable catalog entries</strong>
                <span>
                  Configure and activate exact item or variant prices, then
                  refresh.
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="order-panel" aria-label="Current order">
        <div className="order-panel__header">
          <div>
            <h1>
              {order
                ? channelOptions.find(
                    (option) => option.value === order.channel,
                  )?.label
                : "New order"}
            </h1>
            <p>
              <Icon name="orders" size={18} />
              <span>{order?.orderNumber ?? "Not started"}</span>
              {order ? (
                <>
                  <span className="dot-separator">·</span>
                  <span>{order.clientReference}</span>
                </>
              ) : null}
            </p>
          </div>
          {order?.status === "HELD" ? (
            <button
              className="button button--small"
              onClick={() =>
                void action(() => runtime.resume(order), "Order resumed")
              }
              type="button"
            >
              Resume
            </button>
          ) : null}
        </div>

        {order ? (
          <div className="order-service-summary">
            <span>
              {order.tableName
                ? `Table · ${order.tableName}`
                : order.customerReference
                  ? `Delivery · ${order.customerReference}`
                  : order.tabName
                    ? `Tab · ${order.tabName}`
                    : order.pickupReference
                      ? `Pickup · ${order.pickupReference}`
                      : "No table or service reference"}
            </span>
            {order.guestCount ? <span>{order.guestCount} guest(s)</span> : null}
          </div>
        ) : null}

        <div className="order-lines">
          {order?.lines.length ? (
            order.lines.map((line, index) => (
              <article
                className={line.sent ? "order-line is-sent" : "order-line"}
                key={line.id}
              >
                <span className="order-line__index">{index + 1}</span>
                <div className="order-line__main">
                  <div className="order-line__title">
                    <strong>
                      {line.variantName
                        ? `${line.name} · ${line.variantName}`
                        : line.name}
                    </strong>
                    <span>
                      {formatMoney(
                        money(
                          (line.baseUnitPriceMinor +
                            line.modifierUnitTotalMinor) *
                            line.quantity,
                        ),
                      )}
                    </span>
                  </div>
                  <p>
                    {line.sent
                      ? "Sent · immutable"
                      : line.modifiers
                          .map((modifier) => modifier.name)
                          .join(" · ") || "Draft"}
                  </p>
                  <div
                    className="quantity-control"
                    aria-label={`${line.name} quantity`}
                  >
                    <button
                      aria-label={`Decrease ${line.name}`}
                      disabled={busy || line.sent}
                      onClick={() =>
                        void action(
                          () =>
                            runtime.replaceQuantity(
                              order,
                              line.id,
                              line.quantity - 1,
                            ),
                          "Quantity updated",
                        )
                      }
                      type="button"
                    >
                      <Icon name="minus" size={17} />
                    </button>
                    <strong>{line.quantity}</strong>
                    <button
                      aria-label={`Increase ${line.name}`}
                      disabled={busy || line.sent}
                      onClick={() =>
                        void action(
                          () =>
                            runtime.replaceQuantity(
                              order,
                              line.id,
                              line.quantity + 1,
                            ),
                          "Quantity updated",
                        )
                      }
                      type="button"
                    >
                      <Icon name="plus" size={17} />
                    </button>
                  </div>
                </div>
                <button
                  aria-label={`Remove ${line.name}`}
                  className="line-delete"
                  disabled={busy || line.sent}
                  onClick={() =>
                    void action(
                      () => runtime.removeLine(order, line.id),
                      "Line removed",
                    )
                  }
                  type="button"
                >
                  <Icon name="trash" size={18} />
                </button>
              </article>
            ))
          ) : (
            <div className="empty-order">
              <Icon name="bag" size={34} />
              <strong>Start an order</strong>
              <span>
                Tap a verified menu item. The command is saved before sync
                begins.
              </span>
            </div>
          )}
        </div>

        <div className="order-summary">
          {order?.tickets.length ? (
            <div className="ticket-statuses" aria-label="Preparation status">
              {order.tickets.map((ticket) => (
                <span data-status={ticket.status} key={ticket.id}>
                  {ticket.stationName} · {ticket.status.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          ) : null}
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>
                {formatMoney(money(order?.totals.inputSubtotalMinor ?? 0))}
              </dd>
            </div>
            <div>
              <dt>Net before tax</dt>
              <dd>{formatMoney(money(order?.totals.netTotalMinor ?? 0))}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(money(order?.totals.taxTotalMinor ?? 0))}</dd>
            </div>
            <div className="order-total">
              <dt>Total</dt>
              <dd>{formatMoney(money(order?.totals.grossTotalMinor ?? 0))}</dd>
            </div>
          </dl>
          <p className="fiscal-note">
            <span aria-hidden="true">ⓘ</span>
            <span>
              {data?.taxProfile
                ? `${data.taxProfile.name} · cached deterministic calculation`
                : "Tax configuration unavailable"}
            </span>
          </p>
          <div className="secondary-actions">
            <button
              className="button button--outline"
              disabled={busy || !order || order.status !== "OPEN"}
              onClick={() =>
                order && void action(() => runtime.hold(order), "Order held")
              }
              type="button"
            >
              Hold
            </button>
            <button
              className="button button--send"
              disabled={
                busy ||
                !order ||
                draftLines.length === 0 ||
                order.status !== "OPEN"
              }
              onClick={() =>
                order &&
                void action(() => runtime.send(order), "Send wave queued")
              }
              type="button"
            >
              <Icon name="kitchen" size={20} />
              Send
            </button>
          </div>
          <button
            className="button button--pay"
            disabled={
              busy ||
              !order ||
              order.lines.length === 0 ||
              order.status !== "OPEN"
            }
            onClick={() => setPaymentOpen(true)}
            type="button"
          >
            <Icon name="card" size={23} />
            Pay{" "}
            {formatMoney(
              money(
                Math.max(
                  (order?.totals.grossTotalMinor ?? 0) -
                    (order?.confirmedPaymentMinor ?? 0),
                  0,
                ),
              ),
            )}
          </button>
          {order ? (
            <div className="sale-finalize-actions">
              <button
                className="button button--outline"
                disabled={busy}
                onClick={() => void synchronizeSale()}
                type="button"
              >
                <Icon name="recall" size={19} />
                Sync &amp; refresh
              </button>
              <button
                className="button button--complete"
                disabled={
                  busy ||
                  order.confirmedPaymentMinor < order.totals.grossTotalMinor ||
                  order.tickets.some(
                    (ticket) =>
                      ticket.status !== "COMPLETED" &&
                      ticket.status !== "CANCELLED",
                  ) ||
                  order.lines.some((line) => !line.sent)
                }
                onClick={() => void completeSale()}
                type="button"
              >
                Complete sale
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {activeView === "ORDERS" && data ? (
        <OrderWorkspace
          deviceOrderIds={data.orders.map((entry) => entry.id)}
          runtime={runtime}
          tables={data.tables}
          onOpenDeviceOrder={(orderId) => {
            setActiveView("SELL");
            void action(() => runtime.selectOrder(orderId), "Order loaded");
          }}
          onReviewPayments={setPaymentReview}
          onRefreshBootstrap={refreshBootstrap}
        />
      ) : null}

      {activeView === "REFUNDS" ? (
        <RefundWorkspace runtime={runtime} shiftId={data?.shift?.id ?? null} />
      ) : null}

      {activeView === "CASH" ? (
        <CashControlWorkspace runtime={runtime} shift={data?.shift ?? null} />
      ) : null}

      {activeView === "RECEIPTS" ? (
        <ReceiptWorkspace runtime={runtime} />
      ) : null}

      {activeView === "RECOVERY" ? (
        <RecoveryWorkspace runtime={runtime} />
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
      {createOrderOpen ? (
        <CreateOrderDialog
          channel={channel}
          tables={data?.tables ?? []}
          onClose={() => {
            setCreateOrderOpen(false);
            setPendingItem(null);
          }}
          onConfirm={createOrder}
        />
      ) : null}
      {modifierItem ? (
        <ModifierDialog
          item={modifierItem}
          onClose={() => setModifierItem(null)}
          onConfirm={(modifiers) => {
            const item = modifierItem;
            setModifierItem(null);
            void addItem(item, modifiers);
          }}
        />
      ) : null}
      {paymentOpen && order ? (
        <SplitTenderDialog
          canVerify={session.user.permissions.includes("payments.verify")}
          currentUserId={session.scope.userId}
          order={order}
          onClose={() => setPaymentOpen(false)}
          onLoad={() => runtime.listOrderPayments(order.id)}
          onCash={async (amount, tendered) => {
            const queued = await runtime.cashPayment(order, tendered, amount);
            setOrder(queued);
            await runtime.engine.flush();
            if (navigator.onLine) {
              const synchronized = await runtime.synchronize(order.id);
              setBootstrap(synchronized.bootstrap);
              setOrder(synchronized.order);
            }
            setNotice("Cash tender recorded safely");
          }}
          onManual={async (input) => {
            await runtime.createManualTender(order, input);
            setNotice("Manual tender awaits independent verification");
          }}
          onVerify={async (payment, decision, evidence, reason) => {
            await runtime.verifyManualTender(
              payment,
              decision,
              evidence,
              reason,
            );
            const synchronized = await runtime.synchronize(order.id);
            setBootstrap(synchronized.bootstrap);
            setOrder(synchronized.order);
            setNotice(
              decision === "CONFIRM"
                ? "Tender independently confirmed"
                : "Tender marked failed",
            );
          }}
        />
      ) : null}
      {paymentReview ? (
        <TenderVerificationDialog
          canVerify={session.user.permissions.includes("payments.verify")}
          currentUserId={session.scope.userId}
          order={paymentReview}
          onClose={() => setPaymentReview(null)}
          onLoad={() => runtime.listOrderPayments(paymentReview.id)}
          onVerify={async (payment, decision, evidence, reason) => {
            await runtime.verifyManualTender(
              payment,
              decision,
              evidence,
              reason,
            );
            setNotice(
              decision === "CONFIRM"
                ? "Tender independently confirmed"
                : "Tender marked failed",
            );
          }}
        />
      ) : null}
      {offlineAccessOpen ? (
        <OfflineAccessDialog
          enrolled={offlineAccessEnrolled}
          expiresAt={session.offlineAccess.leaseExpiresAt}
          minimumPinLength={session.offlineAccess.minimumPinLength}
          onClose={() => setOfflineAccessOpen(false)}
          onEnroll={async (pin) => {
            const { configureBrowserOfflineUnlock } =
              await import("./offline/browser-runtime");
            await configureBrowserOfflineUnlock(pin);
            setOfflineAccessEnrolled(true);
            setNotice("Offline restart PIN enrolled securely");
          }}
        />
      ) : null}
      {shiftOpen ? (
        <ShiftDialog
          shift={data?.shift ?? null}
          summary={shiftSummary}
          onClose={() => setShiftOpen(false)}
          onOpenShift={async (amount) => {
            await runtime.openShift(amount);
            setShiftOpen(false);
            await refreshBootstrap();
          }}
          onCloseShift={async (amount) => {
            await runtime.closeShift(amount);
            setShiftOpen(false);
            setOrder(null);
            await refreshBootstrap();
          }}
        />
      ) : null}
      {receipt ? (
        <ReceiptDialog
          html={receipt.html}
          receipt={receipt.record}
          onClose={() => setReceipt(null)}
          onReprint={() => runtime.reprintReceipt(receipt.record)}
        />
      ) : null}
    </main>
  );
}
