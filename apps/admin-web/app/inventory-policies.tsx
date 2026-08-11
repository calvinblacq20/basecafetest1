"use client";

import type {
  AvailabilityPreviewResponse,
  CriticalIngredientRuleResponse,
  InventoryConsumptionReconciliationResponse,
  InventoryConsumptionRouteResponse,
  InventoryDeductionPolicyResponse,
  InventoryItemResponse,
  MenuItemConfigurationResponse,
  RecipeVersionResponse,
  StationResponse,
  StockLocationResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  createCriticalIngredientRule,
  createInventoryConsumptionRoute,
  createInventoryDeductionPolicy,
  getInventoryConsumptionReconciliation,
  listCriticalIngredientRules,
  listInventoryConsumptionRoutes,
  listInventoryDeductionPolicies,
  listInventoryItems,
  listMenuItems,
  listRecipeVersions,
  listStations,
  listStockLocations,
  previewInventoryAvailability,
  type AdminSession,
} from "./admin-client";

type PolicyData = {
  policies: InventoryDeductionPolicyResponse[];
  routes: InventoryConsumptionRouteResponse[];
  rules: CriticalIngredientRuleResponse[];
  reconciliation: InventoryConsumptionReconciliationResponse;
  items: InventoryItemResponse[];
  locations: StockLocationResponse[];
  recipes: RecipeVersionResponse[];
  menuItems: MenuItemConfigurationResponse[];
  stations: StationResponse[];
};

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "Inventory policy request failed.";
}

const defaultEffectiveFrom = () => new Date().toISOString().slice(0, 16);

export function InventoryPolicies({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<PolicyData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AvailabilityPreviewResponse | null>(
    null,
  );
  const canConfigure = session.user.permissions.includes("inventory.configure");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [
        policies,
        routes,
        rules,
        reconciliation,
        items,
        locations,
        recipes,
        menuItems,
        stations,
      ] = await Promise.all([
        listInventoryDeductionPolicies(session),
        listInventoryConsumptionRoutes(session),
        listCriticalIngredientRules(session),
        getInventoryConsumptionReconciliation(session),
        listInventoryItems(session),
        listStockLocations(session),
        listRecipeVersions(session),
        listMenuItems(session),
        listStations(session),
      ]);
      setData({
        policies,
        routes,
        rules,
        reconciliation,
        items,
        locations,
        recipes,
        menuItems,
        stations,
      });
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(messageFor(error));
    }
  }, [session]);

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
    } catch (error) {
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function policyCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await perform(
      () =>
        createInventoryDeductionPolicy(session, {
          trigger: String(values.get("trigger")) as
            "SENT" | "PREPARED" | "SERVED" | "COMPLETED",
          effectiveFrom: new Date(
            String(values.get("effectiveFrom")),
          ).toISOString(),
          reason: String(values.get("reason")),
        }),
      "Draft stock-deduction policy created. Activation remains owner-blocked.",
    );
    form.reset();
  }

  async function routeCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await perform(
      () =>
        createInventoryConsumptionRoute(session, {
          inventoryItemId: String(values.get("inventoryItemId")),
          stationId: String(values.get("stationId")),
          locationId: String(values.get("locationId")),
          effectiveFrom: new Date(
            String(values.get("effectiveFrom")),
          ).toISOString(),
          reason: String(values.get("reason")),
        }),
      "Draft station/location route created. It has not been activated.",
    );
    form.reset();
  }

  async function ruleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const recipe = data?.recipes.find(
      (row) => row.id === String(values.get("recipeVersionId")),
    );
    if (!recipe) return notify("Select an active recipe.");
    await perform(
      () =>
        createCriticalIngredientRule(session, {
          menuItemId: recipe.menuItemId,
          menuVariantId: recipe.menuVariantId ?? undefined,
          recipeVersionId: recipe.id,
          effectiveFrom: new Date(
            String(values.get("effectiveFrom")),
          ).toISOString(),
          components: [
            {
              inventoryItemId: String(values.get("inventoryItemId")),
              safetyStockMicros: String(values.get("safetyStockMicros")),
              locationIds: [String(values.get("locationId"))],
            },
          ],
          reason: String(values.get("reason")),
        }),
      "Draft critical-ingredient rule created. Confirmation and activation remain blocked.",
    );
    form.reset();
  }

  async function availabilityPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await previewInventoryAvailability(session, {
        menuItemId: String(values.get("menuItemId")),
        quantity: Number(values.get("quantity")),
        at: new Date().toISOString(),
      });
      setPreview(result);
      notify("Availability preview resolved from authoritative configuration.");
    } catch (error) {
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  if (status === "error") {
    return (
      <div className="live-blocker">
        <strong>Policies could not be loaded</strong>
        <p>{message}</p>
      </div>
    );
  }

  const activeRecipes =
    data?.recipes.filter((recipe) => recipe.status === "ACTIVE") ?? [];

  return (
    <section className="inventory-recipe-grid">
      <div className="inventory-version-lists">
        <article className="live-list-card">
          <header>
            <strong>Stock deduction policy</strong>
            <span>{data?.policies.length ?? 0} versions</span>
          </header>
          <div className="inventory-version-stack">
            {data?.policies.map((policy) => (
              <article className="inventory-version-card" key={policy.id}>
                <div>
                  <strong>{policy.trigger}</strong>
                  <span>
                    {policy.status} / r{policy.revision}
                  </span>
                </div>
                <p>
                  Effective{" "}
                  {new Date(policy.effectiveFrom).toLocaleString("en-GH", {
                    timeZone: "Africa/Accra",
                  })}
                </p>
              </article>
            ))}
            {!data?.policies.length ? (
              <p className="live-empty">
                No policy configured. Automatic stock deduction is disabled.
              </p>
            ) : null}
          </div>
        </article>

        <article className="live-list-card">
          <header>
            <strong>Consumption routes</strong>
            <span>{data?.routes.length ?? 0} versions</span>
          </header>
          <div className="inventory-version-stack">
            {data?.routes.map((route) => (
              <article className="inventory-version-card" key={route.id}>
                <div>
                  <strong>{route.inventoryItem.name}</strong>
                  <span>
                    {route.status} / r{route.revision}
                  </span>
                </div>
                <p>
                  {route.station?.name ?? "Any station"} → {route.location.name}
                </p>
              </article>
            ))}
            {!data?.routes.length ? (
              <p className="live-empty">No location routes configured.</p>
            ) : null}
          </div>
        </article>

        <article className="live-list-card">
          <header>
            <strong>Critical ingredient rules</strong>
            <span>{data?.rules.length ?? 0} versions</span>
          </header>
          <div className="inventory-version-stack">
            {data?.rules.map((rule) => (
              <article className="inventory-version-card" key={rule.id}>
                <div>
                  <strong>
                    {rule.menuItem.name}
                    {rule.menuVariant ? ` / ${rule.menuVariant.name}` : ""}
                  </strong>
                  <span>
                    {rule.status} / r{rule.revision}
                  </span>
                </div>
                <p>
                  {rule.components
                    .map(
                      (component) =>
                        `${component.inventoryItem.name}: safety ${component.safetyStockMicros} micros`,
                    )
                    .join("; ")}
                </p>
              </article>
            ))}
            {!data?.rules.length ? (
              <p className="live-empty">No critical-stock rule configured.</p>
            ) : null}
          </div>
        </article>

        <article className="live-list-card">
          <header>
            <strong>Reconciliation posture</strong>
            <span>{status === "loading" ? "Loading…" : "Live"}</span>
          </header>
          <div className="inventory-version-card">
            <div>
              <strong>
                {data?.reconciliation.configurationIssue ??
                  "Configuration active"}
              </strong>
              <span>
                {data?.reconciliation.postingCommandEnabled
                  ? "Posting enabled"
                  : "Posting disabled"}
              </span>
            </div>
            <p>
              Automatic event dispatch remains disabled. Sent without
              consumption:{" "}
              {data?.reconciliation.counts.sentLinesWithoutConsumption ?? 0};
              posted: {data?.reconciliation.counts.postedConsumptions ?? 0}.
            </p>
          </div>
        </article>
      </div>

      <aside className="inventory-forms">
        <div className="live-blocker">
          <strong>Owner confirmation required before activation</strong>
          <p>
            Drafts can be prepared now. Trigger timing, critical ingredients,
            safety stock and source locations must be confirmed before any
            policy or rule is activated.
          </p>
        </div>

        {canConfigure ? (
          <>
            <article className="config-card compact-form-card">
              <p className="live-eyebrow">Draft only</p>
              <h2>Deduction policy</h2>
              <form className="live-form" onSubmit={policyCreate}>
                <select name="trigger" aria-label="Deduction trigger">
                  <option>COMPLETED</option>
                  <option>SENT</option>
                  <option>PREPARED</option>
                  <option>SERVED</option>
                </select>
                <label>
                  Effective from
                  <input
                    name="effectiveFrom"
                    type="datetime-local"
                    defaultValue={defaultEffectiveFrom()}
                    required
                  />
                </label>
                <textarea name="reason" placeholder="Draft reason" required />
                <button disabled={busy}>Create draft policy</button>
              </form>
            </article>

            <article className="config-card compact-form-card">
              <p className="live-eyebrow">Draft only</p>
              <h2>Consumption route</h2>
              <form className="live-form" onSubmit={routeCreate}>
                <select
                  name="inventoryItemId"
                  aria-label="Routed inventory item"
                  required
                >
                  <option value="">Inventory item</option>
                  {data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select name="stationId" aria-label="Preparation station">
                  <option value="">Any station</option>
                  {data?.stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
                <select
                  name="locationId"
                  aria-label="Deduction location"
                  required
                >
                  <option value="">Stock location</option>
                  {data?.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <label>
                  Effective from
                  <input
                    name="effectiveFrom"
                    type="datetime-local"
                    defaultValue={defaultEffectiveFrom()}
                    required
                  />
                </label>
                <textarea name="reason" placeholder="Draft reason" required />
                <button disabled={busy}>Create draft route</button>
              </form>
            </article>

            <article className="config-card compact-form-card">
              <p className="live-eyebrow">Draft only</p>
              <h2>Critical-stock rule</h2>
              <form className="live-form" onSubmit={ruleCreate}>
                <select
                  name="recipeVersionId"
                  aria-label="Active menu recipe"
                  required
                >
                  <option value="">Active recipe</option>
                  {activeRecipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.menuItem.name}
                      {recipe.menuVariant
                        ? ` / ${recipe.menuVariant.name}`
                        : ""}{" "}
                      v{recipe.version}
                    </option>
                  ))}
                </select>
                <select
                  name="inventoryItemId"
                  aria-label="Critical inventory item"
                  required
                >
                  <option value="">Critical ingredient</option>
                  {data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  name="locationId"
                  aria-label="Eligible stock location"
                  required
                >
                  <option value="">Eligible location</option>
                  {data?.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <input
                  name="safetyStockMicros"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  placeholder="Safety stock micros"
                  required
                />
                <label>
                  Effective from
                  <input
                    name="effectiveFrom"
                    type="datetime-local"
                    defaultValue={defaultEffectiveFrom()}
                    required
                  />
                </label>
                <textarea name="reason" placeholder="Draft reason" required />
                <button disabled={busy}>Create draft rule</button>
              </form>
            </article>
          </>
        ) : null}

        <article className="config-card compact-form-card">
          <p className="live-eyebrow">Read-only resolver</p>
          <h2>Availability preview</h2>
          <form className="live-form" onSubmit={availabilityPreview}>
            <select
              name="menuItemId"
              aria-label="Availability menu item"
              required
            >
              <option value="">Menu item</option>
              {data?.menuItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              name="quantity"
              type="number"
              min="1"
              max="1000"
              defaultValue="1"
              required
            />
            <button disabled={busy}>Resolve preview</button>
          </form>
          {preview ? (
            <div className="inventory-version-card">
              <strong>{preview.available ? "AVAILABLE" : "UNAVAILABLE"}</strong>
              <p>
                {preview.issueCode ?? "Configured"}
                {preview.maxSellableQuantity
                  ? ` · maximum ${preview.maxSellableQuantity}`
                  : ""}
              </p>
            </div>
          ) : null}
        </article>
      </aside>
    </section>
  );
}
