"use client";

import type {
  BatchProductionPreviewResponse,
  BatchProductionResponse,
  BatchRecipeVersionResponse,
  InventoryItemResponse,
  InventoryTransferResponse,
  StockCountResponse,
  StockLocationResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  activateBatchRecipeVersion,
  createBatchRecipeVersion,
  createStockCount,
  listBatchProductions,
  listBatchRecipeVersions,
  listInventoryItems,
  listInventoryTransfers,
  listStockCounts,
  listStockLocations,
  postBatchProduction,
  postInventoryTransfer,
  postStockCount,
  previewBatchProduction,
  reverseBatchProduction,
  type AdminSession,
} from "./admin-client";

type QuantityRow = { inventoryItemId: string; quantityMicros: string };
type OperationsData = {
  locations: StockLocationResponse[];
  items: InventoryItemResponse[];
  transfers: InventoryTransferResponse[];
  counts: StockCountResponse[];
  recipes: BatchRecipeVersionResponse[];
  productions: BatchProductionResponse[];
};

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The inventory operation could not be completed.";
}

function formatMicros(value: string, code?: string) {
  const quantity = BigInt(value);
  const negative = quantity < 0n;
  const absolute = negative ? -quantity : quantity;
  const whole = absolute / 1_000_000n;
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}${
    code ? ` ${code}` : ""
  }`;
}

export function InventoryOperations({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<OperationsData | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [countLines, setCountLines] = useState<QuantityRow[]>([
    { inventoryItemId: "", quantityMicros: "" },
  ]);
  const [batchComponents, setBatchComponents] = useState<QuantityRow[]>([
    { inventoryItemId: "", quantityMicros: "" },
  ]);
  const [selectedBatchRecipeId, setSelectedBatchRecipeId] = useState("");
  const [batchPreview, setBatchPreview] =
    useState<BatchProductionPreviewResponse | null>(null);
  const canRead = session.user.permissions.includes("inventory.read");
  const canConfigure = session.user.permissions.includes("inventory.configure");
  const canWrite = session.user.permissions.includes("inventory.write");
  const canManage = session.user.permissions.includes("inventory.manage");

  const load = useCallback(async () => {
    if (!canRead) {
      setMessage("The current session does not have inventory.read.");
      return;
    }
    setMessage("");
    try {
      const [locations, items, transfers, counts, recipes, productions] =
        await Promise.all([
          listStockLocations(session),
          listInventoryItems(session),
          listInventoryTransfers(session),
          listStockCounts(session),
          listBatchRecipeVersions(session),
          listBatchProductions(session),
        ]);
      setData({ locations, items, transfers, counts, recipes, productions });
    } catch (error) {
      setMessage(messageFor(error));
      setData(null);
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

  async function transferCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          postInventoryTransfer(session, {
            inventoryItemId: String(values.get("inventoryItemId")),
            fromLocationId: String(values.get("fromLocationId")),
            toLocationId: String(values.get("toLocationId")),
            quantityMicros: String(values.get("quantityMicros")),
            reason: String(values.get("reason")),
          }),
        "Transfer posted as balanced outbound and inbound ledger entries.",
      )
    )
      form.reset();
  }

  async function countCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createStockCount(session, {
            locationId: String(values.get("locationId")),
            lines: countLines.map((line) => ({
              inventoryItemId: line.inventoryItemId,
              countedQuantityMicros: line.quantityMicros,
            })),
            reason: String(values.get("reason")),
          }),
        "Draft stock count created without changing stock.",
      )
    ) {
      form.reset();
      setCountLines([{ inventoryItemId: "", quantityMicros: "" }]);
    }
  }

  async function countPost(
    event: FormEvent<HTMLFormElement>,
    count: StockCountResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => postStockCount(session, count, reason),
        "Stock count posted with append-only variance entries.",
      )
    )
      form.reset();
  }

  async function batchRecipeCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createBatchRecipeVersion(session, {
            outputInventoryItemId: String(values.get("outputInventoryItemId")),
            yieldQuantityMicros: String(values.get("yieldQuantityMicros")),
            effectiveFrom: new Date(
              String(values.get("effectiveFrom")),
            ).toISOString(),
            components: batchComponents,
            reason: String(values.get("reason")),
          }),
        "Draft batch recipe created.",
      )
    ) {
      form.reset();
      setBatchComponents([{ inventoryItemId: "", quantityMicros: "" }]);
    }
  }

  async function batchRecipeActivate(
    event: FormEvent<HTMLFormElement>,
    recipe: BatchRecipeVersionResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => activateBatchRecipeVersion(session, recipe, reason),
        "Batch recipe activated with immutable history.",
      )
    )
      form.reset();
  }

  const selectedBatchRecipe = data?.recipes.find(
    (recipe) => recipe.id === selectedBatchRecipeId,
  );

  async function batchPreviewCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!selectedBatchRecipe) return;
    setBusy(true);
    try {
      const preview = await previewBatchProduction(session, {
        batchRecipeVersionId: selectedBatchRecipe.id,
        outputQuantityMicros: String(values.get("outputQuantityMicros")),
        outputLocationId: String(values.get("outputLocationId")),
        inputLocations: selectedBatchRecipe.components.map((component) => ({
          inventoryItemId: component.inventoryItemId,
          locationId: String(
            values.get(`inputLocation:${component.inventoryItemId}`),
          ),
        })),
        occurredAt: new Date().toISOString(),
      });
      setBatchPreview(preview);
      notify("Exact batch input preview resolved; nothing posted yet.");
    } catch (error) {
      setBatchPreview(null);
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function batchPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchPreview) return;
    const reason = String(new FormData(event.currentTarget).get("reason"));
    if (
      await perform(
        () => postBatchProduction(session, batchPreview, reason),
        "Batch production posted with exact input/output ledger entries.",
      )
    )
      setBatchPreview(null);
  }

  async function batchReverse(
    event: FormEvent<HTMLFormElement>,
    production: BatchProductionResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => reverseBatchProduction(session, production, reason),
        "Batch reversed through linked compensating ledger entries.",
      )
    )
      form.reset();
  }

  if (!canRead || message) {
    return (
      <div className="live-blocker">
        <strong>Inventory operations unavailable</strong>
        <p>{message || "inventory.read is required."}</p>
      </div>
    );
  }

  return (
    <section className="inventory-operations">
      <div className="inventory-operation-column">
        <article className="live-list-card">
          <header>
            <strong>Transfers</strong>
            <span>{data?.transfers.length ?? 0} retained</span>
          </header>
          <div className="inventory-version-stack">
            {data?.transfers.map((transfer) => (
              <article className="inventory-version-card" key={transfer.id}>
                <div>
                  <strong>{transfer.inventoryItem.name}</strong>
                  <span>
                    {formatMicros(
                      transfer.quantityMicros,
                      transfer.inventoryItem.baseUnit.code,
                    )}
                  </span>
                </div>
                <p>
                  {transfer.fromLocation.name} → {transfer.toLocation.name} by{" "}
                  {transfer.actorDisplayName}
                </p>
                <p>{transfer.reason}</p>
              </article>
            ))}
            {!data?.transfers.length ? (
              <p className="live-empty">No transfers posted.</p>
            ) : null}
          </div>
        </article>

        <article className="live-list-card">
          <header>
            <strong>Stock counts</strong>
            <span>{data?.counts.length ?? 0} retained</span>
          </header>
          <div className="inventory-version-stack">
            {data?.counts.map((count) => (
              <article className="inventory-version-card" key={count.id}>
                <div>
                  <strong>{count.location.name}</strong>
                  <span>
                    {count.status} / r{count.revision}
                  </span>
                </div>
                <ul>
                  {count.lines.map((line) => (
                    <li key={line.inventoryItemId}>
                      {line.inventoryItem.name}:{" "}
                      {formatMicros(
                        line.countedQuantityMicros,
                        line.inventoryItem.baseUnit.code,
                      )}
                    </li>
                  ))}
                </ul>
                <p>
                  Created by {count.createdByDisplayName}. {count.reason}
                </p>
                {count.status === "DRAFT" && canWrite ? (
                  <form
                    className="inventory-inline-action"
                    onSubmit={(event) => countPost(event, count)}
                  >
                    <input
                      name="reason"
                      placeholder="Posting reason"
                      required
                    />
                    <button disabled={busy}>Post variances</button>
                  </form>
                ) : null}
              </article>
            ))}
            {!data?.counts.length ? (
              <p className="live-empty">No stock counts retained.</p>
            ) : null}
          </div>
        </article>

        <article className="live-list-card">
          <header>
            <strong>Batch recipes & production</strong>
            <span>{data?.productions.length ?? 0} productions</span>
          </header>
          <div className="inventory-version-stack">
            {data?.recipes.map((recipe) => (
              <article className="inventory-version-card" key={recipe.id}>
                <div>
                  <strong>{recipe.outputInventoryItem.name}</strong>
                  <span>
                    recipe v{recipe.version} / {recipe.status} / r
                    {recipe.revision}
                  </span>
                </div>
                <p>
                  Yield{" "}
                  {formatMicros(
                    recipe.yieldQuantityMicros,
                    recipe.outputInventoryItem.baseUnit.code,
                  )}
                </p>
                <ul>
                  {recipe.components.map((component) => (
                    <li key={component.inventoryItemId}>
                      {component.inventoryItem.name}:{" "}
                      {formatMicros(
                        component.quantityMicros,
                        component.inventoryItem.baseUnit.code,
                      )}
                    </li>
                  ))}
                </ul>
                {recipe.status === "DRAFT" && canConfigure ? (
                  <form
                    className="inventory-inline-action"
                    onSubmit={(event) => batchRecipeActivate(event, recipe)}
                  >
                    <input
                      name="reason"
                      placeholder="Activation reason"
                      required
                    />
                    <button disabled={busy}>
                      Activate verified batch recipe
                    </button>
                  </form>
                ) : null}
              </article>
            ))}

            {data?.productions.map((production) => (
              <article className="inventory-version-card" key={production.id}>
                <div>
                  <strong>{production.outputInventoryItem.name}</strong>
                  <span>
                    {production.reversal ? "REVERSED" : "POSTED"} / r
                    {production.revision}
                  </span>
                </div>
                <p>
                  Output {formatMicros(production.outputQuantityMicros)} to{" "}
                  {production.outputLocation.name} by{" "}
                  {production.actorDisplayName}
                </p>
                <ul>
                  {production.inputs.map((input) => (
                    <li key={input.id}>
                      Input {input.inventoryItem.name}:{" "}
                      {formatMicros(input.quantityMicros)} from{" "}
                      {input.location.name}
                    </li>
                  ))}
                </ul>
                <p>{production.reason}</p>
                {!production.reversal && canManage ? (
                  <form
                    className="inventory-inline-action"
                    onSubmit={(event) => batchReverse(event, production)}
                  >
                    <input
                      name="reason"
                      placeholder="Reversal reason"
                      required
                    />
                    <button disabled={busy}>Post compensating reversal</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </article>
      </div>

      <aside className="inventory-forms inventory-operation-forms">
        <article className="config-card compact-form-card">
          <p className="live-eyebrow">Balanced location movement</p>
          <h2>Post transfer</h2>
          {canWrite ? (
            <form className="live-form" onSubmit={transferCreate}>
              <select
                name="inventoryItemId"
                aria-label="Transfer item"
                required
              >
                <option value="">Inventory item</option>
                {data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select name="fromLocationId" aria-label="Transfer from" required>
                <option value="">From location</option>
                {data?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <select name="toLocationId" aria-label="Transfer to" required>
                <option value="">To location</option>
                {data?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input
                name="quantityMicros"
                inputMode="numeric"
                pattern="[1-9][0-9]{0,18}"
                placeholder="Quantity in micros"
                required
              />
              <p>Negative-stock override remains disabled.</p>
              <textarea name="reason" placeholder="Reason" required />
              <button disabled={busy || (data?.locations.length ?? 0) < 2}>
                Post transfer
              </button>
            </form>
          ) : (
            <p className="live-empty">inventory.write is required.</p>
          )}
        </article>

        <article className="config-card compact-form-card">
          <p className="live-eyebrow">Draft then post</p>
          <h2>Create stock count</h2>
          {canWrite ? (
            <form className="live-form" onSubmit={countCreate}>
              <select name="locationId" aria-label="Count location" required>
                <option value="">Count location</option>
                {data?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <QuantityEditor
                rows={countLines}
                setRows={setCountLines}
                items={data?.items ?? []}
                label="Count line"
                allowZero
              />
              <textarea name="reason" placeholder="Creation reason" required />
              <button disabled={busy}>Create draft count</button>
            </form>
          ) : (
            <p className="live-empty">inventory.write is required.</p>
          )}
        </article>

        <article className="config-card compact-form-card">
          <p className="live-eyebrow">Effective-dated prep formula</p>
          <h2>Create batch recipe</h2>
          {canConfigure ? (
            <form className="live-form" onSubmit={batchRecipeCreate}>
              <select
                name="outputInventoryItemId"
                aria-label="Batch output item"
                required
              >
                <option value="">Output inventory item</option>
                {data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                name="yieldQuantityMicros"
                inputMode="numeric"
                pattern="[1-9][0-9]{0,18}"
                placeholder="Yield quantity in micros"
                required
              />
              <label>
                Effective from
                <input name="effectiveFrom" type="datetime-local" required />
              </label>
              <QuantityEditor
                rows={batchComponents}
                setRows={setBatchComponents}
                items={data?.items ?? []}
                label="Batch input"
              />
              <textarea name="reason" placeholder="Reason" required />
              <button disabled={busy || (data?.items.length ?? 0) < 2}>
                Create draft batch recipe
              </button>
            </form>
          ) : (
            <p className="live-empty">inventory.configure is required.</p>
          )}
        </article>

        <article className="config-card compact-form-card">
          <p className="live-eyebrow">Preview before posting</p>
          <h2>Post batch production</h2>
          {canWrite ? (
            <>
              <form className="live-form" onSubmit={batchPreviewCreate}>
                <select
                  aria-label="Active batch recipe"
                  value={selectedBatchRecipeId}
                  onChange={(event) => {
                    setSelectedBatchRecipeId(event.target.value);
                    setBatchPreview(null);
                  }}
                  required
                >
                  <option value="">Active batch recipe</option>
                  {data?.recipes
                    .filter((recipe) => recipe.status === "ACTIVE")
                    .map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.outputInventoryItem.name} / v{recipe.version}
                      </option>
                    ))}
                </select>
                <input
                  name="outputQuantityMicros"
                  inputMode="numeric"
                  pattern="[1-9][0-9]{0,18}"
                  placeholder="Output quantity in micros"
                  required
                />
                <select
                  name="outputLocationId"
                  aria-label="Batch output location"
                  required
                >
                  <option value="">Output location</option>
                  {data?.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                {selectedBatchRecipe?.components.map((component) => (
                  <label key={component.inventoryItemId}>
                    Input location: {component.inventoryItem.name}
                    <select
                      name={`inputLocation:${component.inventoryItemId}`}
                      required
                    >
                      <option value="">Input location</option>
                      {data?.locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button disabled={busy || !selectedBatchRecipe}>
                  Preview exact inputs
                </button>
              </form>
              {batchPreview ? (
                <form
                  className="live-form inventory-preview-card"
                  onSubmit={batchPost}
                >
                  <strong>Resolved exact inputs</strong>
                  {batchPreview.inputs.map((input) => (
                    <p key={input.inventoryItemId}>
                      {input.inventoryItemName}:{" "}
                      {formatMicros(input.quantityMicros)}
                    </p>
                  ))}
                  <textarea
                    name="reason"
                    placeholder="Posting reason"
                    required
                  />
                  <button disabled={busy}>Post immutable production</button>
                </form>
              ) : null}
            </>
          ) : (
            <p className="live-empty">inventory.write is required.</p>
          )}
        </article>
      </aside>
    </section>
  );
}

function QuantityEditor({
  rows,
  setRows,
  items,
  label,
  allowZero = false,
}: {
  rows: QuantityRow[];
  setRows: (rows: QuantityRow[]) => void;
  items: InventoryItemResponse[];
  label: string;
  allowZero?: boolean;
}) {
  return (
    <div className="inventory-component-editor">
      <strong>{label}s</strong>
      {rows.map((row, index) => (
        <div className="inventory-component-row" key={index}>
          <select
            aria-label={`${label} item ${index + 1}`}
            value={row.inventoryItemId}
            onChange={(event) =>
              setRows(
                rows.map((entry, rowIndex) =>
                  rowIndex === index
                    ? { ...entry, inventoryItemId: event.target.value }
                    : entry,
                ),
              )
            }
            required
          >
            <option value="">Inventory item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.baseUnit.code})
              </option>
            ))}
          </select>
          <input
            aria-label={`${label} quantity ${index + 1}`}
            inputMode="numeric"
            pattern={allowZero ? "(0|[1-9][0-9]{0,18})" : "[1-9][0-9]{0,18}"}
            placeholder="Quantity in micros"
            value={row.quantityMicros}
            onChange={(event) =>
              setRows(
                rows.map((entry, rowIndex) =>
                  rowIndex === index
                    ? { ...entry, quantityMicros: event.target.value }
                    : entry,
                ),
              )
            }
            required
          />
          <button
            type="button"
            disabled={rows.length === 1}
            onClick={() =>
              setRows(rows.filter((_, rowIndex) => rowIndex !== index))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setRows([...rows, { inventoryItemId: "", quantityMicros: "" }])
        }
      >
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}
