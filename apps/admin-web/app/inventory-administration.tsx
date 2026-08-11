"use client";

import type {
  InventoryBalanceResponse,
  InventoryItemResponse,
  InventoryUnitResponse,
  MenuItemConfigurationResponse,
  ModifierGroupResponse,
  ModifierRecipeEffectResponse,
  RecipeVersionResponse,
  StockLedgerEntryResponse,
  StockLocationResponse,
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
  activateModifierRecipeEffect,
  activateRecipeVersion,
  createInventoryUnitConversion,
  createInventoryItem,
  createInventoryUnit,
  createModifierRecipeEffect,
  createRecipeVersion,
  createStockLocation,
  listInventoryBalances,
  listInventoryItems,
  listInventoryUnits,
  listMenuItems,
  listModifierGroups,
  listModifierRecipeEffects,
  listRecipeVersions,
  listStockLedger,
  listStockLocations,
  postStockAdjustment,
  type AdminSession,
} from "./admin-client";
import { InventoryOperations } from "./inventory-operations";
import { InventoryPolicies } from "./inventory-policies";

type InventoryView =
  "setup" | "recipes" | "operations" | "policies" | "balances" | "ledger";
type InventoryData = {
  units: InventoryUnitResponse[];
  locations: StockLocationResponse[];
  items: InventoryItemResponse[];
  balances: InventoryBalanceResponse[];
  ledger: StockLedgerEntryResponse[];
  recipes: RecipeVersionResponse[];
  modifierEffects: ModifierRecipeEffectResponse[];
  menuItems: MenuItemConfigurationResponse[];
  modifierGroups: ModifierGroupResponse[];
};

type RecipeComponentInput = {
  inventoryItemId: string;
  quantityMicros: string;
};
type ModifierComponentInput = RecipeComponentInput & {
  kind: "ADD" | "REMOVE" | "REPLACE_ADD" | "REPLACE_REMOVE";
};

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The inventory request could not be completed.";
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

export function InventoryAdministration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<InventoryView>("setup");
  const [data, setData] = useState<InventoryData | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "denied" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipeComponents, setRecipeComponents] = useState<
    RecipeComponentInput[]
  >([{ inventoryItemId: "", quantityMicros: "" }]);
  const [modifierComponents, setModifierComponents] = useState<
    ModifierComponentInput[]
  >([{ inventoryItemId: "", kind: "ADD", quantityMicros: "" }]);
  const canRead = session.user.permissions.includes("inventory.read");
  const canConfigure = session.user.permissions.includes("inventory.configure");
  const canWrite = session.user.permissions.includes("inventory.write");

  const load = useCallback(async () => {
    if (!canRead) {
      setStatus("denied");
      setMessage("The current session does not have inventory.read.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const [
        units,
        locations,
        items,
        balances,
        ledger,
        recipes,
        modifierEffects,
        menuItems,
        modifierGroups,
      ] = await Promise.all([
        listInventoryUnits(session),
        listStockLocations(session),
        listInventoryItems(session),
        listInventoryBalances(session),
        listStockLedger(session),
        listRecipeVersions(session),
        listModifierRecipeEffects(session),
        listMenuItems(session),
        listModifierGroups(session),
      ]);
      setData({
        units,
        locations,
        items,
        balances,
        ledger,
        recipes,
        modifierEffects,
        menuItems,
        modifierGroups,
      });
      setStatus("ready");
    } catch (error) {
      setData(null);
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

  const balances = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.balances ?? [])
      map.set(`${row.locationId}:${row.inventoryItemId}`, row.quantityMicros);
    return map;
  }, [data]);

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

  async function unitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createInventoryUnit(session, {
            code: String(values.get("code")),
            name: String(values.get("name")),
            dimension: String(values.get("dimension")) as
              "MASS" | "VOLUME" | "COUNT",
            reason: String(values.get("reason")),
          }),
        "Inventory unit created with audit and outbox history.",
      )
    )
      form.reset();
  }

  async function locationCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createStockLocation(session, {
            externalKey: String(values.get("externalKey")),
            name: String(values.get("name")),
            kind: String(values.get("kind")) as
              "STORE" | "KITCHEN" | "BAR" | "OTHER",
            reason: String(values.get("reason")),
          }),
        "Stock location created with audit and outbox history.",
      )
    )
      form.reset();
  }

  async function itemCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createInventoryItem(session, {
            externalKey: String(values.get("externalKey")),
            name: String(values.get("name")),
            baseUnitId: String(values.get("baseUnitId")),
            reason: String(values.get("reason")),
          }),
        "Inventory item created with audit and outbox history.",
      )
    )
      form.reset();
  }

  async function conversionCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createInventoryUnitConversion(session, {
            fromUnitId: String(values.get("fromUnitId")),
            toUnitId: String(values.get("toUnitId")),
            numerator: String(values.get("numerator")),
            denominator: String(values.get("denominator")),
            reason: String(values.get("reason")),
          }),
        "Exact unit conversion created.",
      )
    )
      form.reset();
  }

  async function recipeCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const [selectedMenuItemId, menuVariantId = ""] = String(
      values.get("menuTarget"),
    ).split(":");
    const menuItemId = selectedMenuItemId ?? "";
    if (
      await perform(
        () =>
          createRecipeVersion(session, {
            menuItemId,
            menuVariantId,
            yieldQuantityMicros: String(values.get("yieldQuantityMicros")),
            effectiveFrom: new Date(
              String(values.get("effectiveFrom")),
            ).toISOString(),
            components: recipeComponents,
            reason: String(values.get("reason")),
          }),
        "Draft recipe version created.",
      )
    ) {
      form.reset();
      setRecipeComponents([{ inventoryItemId: "", quantityMicros: "" }]);
    }
  }

  async function recipeActivate(
    event: FormEvent<HTMLFormElement>,
    recipe: RecipeVersionResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => activateRecipeVersion(session, recipe, reason),
        "Recipe version activated with immutable history.",
      )
    )
      form.reset();
  }

  async function modifierEffectCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createModifierRecipeEffect(session, {
            menuModifierId: String(values.get("menuModifierId")),
            effectiveFrom: new Date(
              String(values.get("effectiveFrom")),
            ).toISOString(),
            components: modifierComponents,
            reason: String(values.get("reason")),
          }),
        "Draft modifier stock effect created.",
      )
    ) {
      form.reset();
      setModifierComponents([
        { inventoryItemId: "", kind: "ADD", quantityMicros: "" },
      ]);
    }
  }

  async function modifierEffectActivate(
    event: FormEvent<HTMLFormElement>,
    effect: ModifierRecipeEffectResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (
      await perform(
        () => activateModifierRecipeEffect(session, effect, reason),
        "Modifier stock effect activated with immutable history.",
      )
    )
      form.reset();
  }

  async function adjustmentCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          postStockAdjustment(session, {
            locationId: String(values.get("locationId")),
            inventoryItemId: String(values.get("inventoryItemId")),
            type: String(values.get("type")) as
              "OPENING_BALANCE" | "MANUAL_ADJUSTMENT" | "WASTE",
            quantityDeltaMicros: String(values.get("quantityDeltaMicros")),
            reason: String(values.get("reason")),
          }),
        "Append-only stock entry posted.",
      )
    )
      form.reset();
  }

  const negativeBalances = [...balances.values()].filter((value) =>
    value.startsWith("-"),
  ).length;

  return (
    <section className="inventory-admin">
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Append-only stock control</p>
          <h1>Inventory</h1>
          <p>
            Configure units, locations and ingredients, then inspect exact
            micro-unit balances and immutable ledger entries.
          </p>
        </div>
        <button className="live-primary" onClick={() => void load()}>
          Refresh inventory
        </button>
      </header>

      {status === "denied" || status === "error" ? (
        <div className="live-blocker">
          <strong>
            {status === "denied"
              ? "Inventory permission required"
              : "Inventory could not be loaded"}
          </strong>
          <p>{message}</p>
        </div>
      ) : null}

      <section className="inventory-kpis">
        <div>
          <span>Units</span>
          <strong>{data?.units.length ?? 0}</strong>
        </div>
        <div>
          <span>Stock locations</span>
          <strong>{data?.locations.length ?? 0}</strong>
        </div>
        <div>
          <span>Inventory items</span>
          <strong>{data?.items.length ?? 0}</strong>
        </div>
        <div>
          <span>Negative balances</span>
          <strong className={negativeBalances ? "is-negative" : ""}>
            {negativeBalances}
          </strong>
        </div>
      </section>

      <nav
        className="config-tabs inventory-tabs"
        aria-label="Inventory dataset"
      >
        <button
          className={view === "setup" ? "is-active" : ""}
          onClick={() => setView("setup")}
        >
          Master data
        </button>
        <button
          className={view === "recipes" ? "is-active" : ""}
          onClick={() => setView("recipes")}
        >
          Recipes & effects
        </button>
        <button
          className={view === "operations" ? "is-active" : ""}
          onClick={() => setView("operations")}
        >
          Operations
        </button>
        <button
          className={view === "policies" ? "is-active" : ""}
          onClick={() => setView("policies")}
        >
          Policies & availability
        </button>
        <button
          className={view === "balances" ? "is-active" : ""}
          onClick={() => setView("balances")}
        >
          Balances
        </button>
        <button
          className={view === "ledger" ? "is-active" : ""}
          onClick={() => setView("ledger")}
        >
          Stock ledger
        </button>
      </nav>

      {view === "setup" ? (
        <section className="inventory-setup-grid">
          <article className="live-list-card inventory-records">
            <header>
              <strong>Configured master data</strong>
              <span>{status === "loading" ? "Loading…" : "Live"}</span>
            </header>
            <div className="inventory-record-section">
              <h2>Units</h2>
              {data?.units.map((unit) => (
                <div className="inventory-record" key={unit.id}>
                  <strong>{unit.name}</strong>
                  <span>
                    {unit.code} · {unit.dimension} · r{unit.revision}
                  </span>
                  {unit.conversionsFrom.map((conversion) => (
                    <small key={conversion.id}>
                      {conversion.toUnit.code} micros = {unit.code} micros ×{" "}
                      {conversion.numerator} / {conversion.denominator}
                    </small>
                  ))}
                </div>
              ))}
              {!data?.units.length ? <p>No units configured.</p> : null}
            </div>
            <div className="inventory-record-section">
              <h2>Locations</h2>
              {data?.locations.map((location) => (
                <div className="inventory-record" key={location.id}>
                  <strong>{location.name}</strong>
                  <span>
                    {location.externalKey} · {location.kind}
                  </span>
                </div>
              ))}
              {!data?.locations.length ? <p>No locations configured.</p> : null}
            </div>
            <div className="inventory-record-section">
              <h2>Items</h2>
              {data?.items.map((item) => (
                <div className="inventory-record" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.externalKey} · base {item.baseUnit.code}
                  </span>
                </div>
              ))}
              {!data?.items.length ? (
                <p>No inventory items configured.</p>
              ) : null}
            </div>
          </article>

          <aside className="inventory-forms">
            {!canConfigure ? (
              <div className="live-blocker">
                <strong>Configuration permission required</strong>
                <p>
                  Unit, location and item creation requires inventory.configure.
                </p>
              </div>
            ) : (
              <>
                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Organization unit</p>
                  <h2>Create unit</h2>
                  <form className="live-form" onSubmit={unitCreate}>
                    <input name="code" placeholder="Code" required />
                    <input name="name" placeholder="Name" required />
                    <select name="dimension" aria-label="Unit dimension">
                      <option value="COUNT">COUNT</option>
                      <option value="MASS">MASS</option>
                      <option value="VOLUME">VOLUME</option>
                    </select>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy}>Create unit</button>
                  </form>
                </article>
                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Exact rational mapping</p>
                  <h2>Create unit conversion</h2>
                  <form className="live-form" onSubmit={conversionCreate}>
                    <select name="fromUnitId" aria-label="From unit" required>
                      <option value="">From unit</option>
                      {data?.units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.code} / {unit.dimension})
                        </option>
                      ))}
                    </select>
                    <select name="toUnitId" aria-label="To unit" required>
                      <option value="">To unit</option>
                      {data?.units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.code} / {unit.dimension})
                        </option>
                      ))}
                    </select>
                    <div className="inventory-ratio-row">
                      <input
                        name="numerator"
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,18}"
                        placeholder="Multiplier numerator"
                        required
                      />
                      <span>=</span>
                      <input
                        name="denominator"
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,18}"
                        placeholder="Multiplier denominator"
                        required
                      />
                    </div>
                    <p>Both units must share the same dimension.</p>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy || (data?.units.length ?? 0) < 2}>
                      Create conversion
                    </button>
                  </form>
                </article>
                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Branch storage</p>
                  <h2>Create location</h2>
                  <form className="live-form" onSubmit={locationCreate}>
                    <input
                      name="externalKey"
                      placeholder="External key"
                      required
                    />
                    <input name="name" placeholder="Name" required />
                    <select name="kind" aria-label="Location kind">
                      <option value="STORE">STORE</option>
                      <option value="KITCHEN">KITCHEN</option>
                      <option value="BAR">BAR</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy}>Create location</button>
                  </form>
                </article>
                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Ingredient or stock item</p>
                  <h2>Create item</h2>
                  <form className="live-form" onSubmit={itemCreate}>
                    <input
                      name="externalKey"
                      placeholder="External key"
                      required
                    />
                    <input name="name" placeholder="Name" required />
                    <select name="baseUnitId" aria-label="Base unit" required>
                      <option value="">Base unit</option>
                      {data?.units
                        .filter((unit) => unit.isActive)
                        .map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name} ({unit.code})
                          </option>
                        ))}
                    </select>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy || !data?.units.length}>
                      Create item
                    </button>
                  </form>
                </article>
              </>
            )}
          </aside>
        </section>
      ) : null}

      {view === "recipes" ? (
        <section className="inventory-recipe-grid">
          <div className="inventory-version-lists">
            <article className="live-list-card">
              <header>
                <strong>Menu recipes</strong>
                <span>{data?.recipes.length ?? 0} versions</span>
              </header>
              <div className="inventory-version-stack">
                {data?.recipes.map((recipe) => (
                  <article className="inventory-version-card" key={recipe.id}>
                    <div>
                      <strong>
                        {recipe.menuItem.name}
                        {recipe.menuVariant
                          ? ` / ${recipe.menuVariant.name}`
                          : ""}
                      </strong>
                      <span>
                        v{recipe.version} / {recipe.status} / r{recipe.revision}
                      </span>
                    </div>
                    <p>
                      Yield {formatMicros(recipe.yieldQuantityMicros)} /
                      effective{" "}
                      {new Date(recipe.effectiveFrom).toLocaleString("en-GH", {
                        timeZone: "Africa/Accra",
                      })}
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
                        onSubmit={(event) => recipeActivate(event, recipe)}
                      >
                        <input
                          name="reason"
                          placeholder="Activation reason"
                          required
                        />
                        <button disabled={busy}>
                          Activate verified recipe
                        </button>
                      </form>
                    ) : null}
                  </article>
                ))}
                {!data?.recipes.length ? (
                  <p className="live-empty">No recipe versions configured.</p>
                ) : null}
              </div>
            </article>

            <article className="live-list-card">
              <header>
                <strong>Modifier stock effects</strong>
                <span>{data?.modifierEffects.length ?? 0} versions</span>
              </header>
              <div className="inventory-version-stack">
                {data?.modifierEffects.map((effect) => (
                  <article className="inventory-version-card" key={effect.id}>
                    <div>
                      <strong>{effect.menuModifier.name}</strong>
                      <span>
                        v{effect.version} / {effect.status} / r{effect.revision}
                      </span>
                    </div>
                    <ul>
                      {effect.components.map((component) => (
                        <li
                          key={`${component.inventoryItemId}:${component.kind}`}
                        >
                          {component.kind} {component.inventoryItem.name}:{" "}
                          {formatMicros(component.quantityMicros)}
                        </li>
                      ))}
                    </ul>
                    {effect.status === "DRAFT" && canConfigure ? (
                      <form
                        className="inventory-inline-action"
                        onSubmit={(event) =>
                          modifierEffectActivate(event, effect)
                        }
                      >
                        <input
                          name="reason"
                          placeholder="Activation reason"
                          required
                        />
                        <button disabled={busy}>
                          Activate verified effect
                        </button>
                      </form>
                    ) : null}
                  </article>
                ))}
                {!data?.modifierEffects.length ? (
                  <p className="live-empty">No modifier effects configured.</p>
                ) : null}
              </div>
            </article>
          </div>

          <aside className="inventory-forms">
            {!canConfigure ? (
              <div className="live-blocker">
                <strong>Configuration permission required</strong>
                <p>Recipe and modifier effects require inventory.configure.</p>
              </div>
            ) : (
              <>
                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Effective-dated composition</p>
                  <h2>Create draft recipe</h2>
                  <form className="live-form" onSubmit={recipeCreate}>
                    <select
                      name="menuTarget"
                      aria-label="Menu item or variant"
                      required
                    >
                      <option value="">Menu item or exact variant</option>
                      {data?.menuItems.map((item) => (
                        <optgroup key={item.id} label={item.name}>
                          <option value={`${item.id}:`}>
                            {item.name} (base)
                          </option>
                          {item.variants.map((variant) => (
                            <option
                              key={variant.id}
                              value={`${item.id}:${variant.id}`}
                            >
                              {item.name} / {variant.name}
                            </option>
                          ))}
                        </optgroup>
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
                      <input
                        name="effectiveFrom"
                        type="datetime-local"
                        required
                      />
                    </label>
                    <div className="inventory-component-editor">
                      <strong>Ingredients</strong>
                      {recipeComponents.map((component, index) => (
                        <div className="inventory-component-row" key={index}>
                          <select
                            aria-label={`Recipe ingredient ${index + 1}`}
                            value={component.inventoryItemId}
                            onChange={(event) =>
                              setRecipeComponents((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        inventoryItemId: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                            required
                          >
                            <option value="">Ingredient</option>
                            {data?.items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.baseUnit.code})
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={`Recipe ingredient quantity ${index + 1}`}
                            inputMode="numeric"
                            pattern="[1-9][0-9]{0,18}"
                            placeholder="Micros"
                            value={component.quantityMicros}
                            onChange={(event) =>
                              setRecipeComponents((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        quantityMicros: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                            required
                          />
                          <button
                            type="button"
                            disabled={recipeComponents.length === 1}
                            onClick={() =>
                              setRecipeComponents((rows) =>
                                rows.filter(
                                  (_, rowIndex) => rowIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setRecipeComponents((rows) => [
                            ...rows,
                            { inventoryItemId: "", quantityMicros: "" },
                          ])
                        }
                      >
                        Add ingredient
                      </button>
                    </div>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy}>Create draft recipe</button>
                  </form>
                </article>

                <article className="config-card compact-form-card">
                  <p className="live-eyebrow">Selected modifier delta</p>
                  <h2>Create draft modifier effect</h2>
                  <form className="live-form" onSubmit={modifierEffectCreate}>
                    <select
                      name="menuModifierId"
                      aria-label="Menu modifier"
                      required
                    >
                      <option value="">Menu modifier</option>
                      {data?.modifierGroups.flatMap((group) =>
                        group.modifiers.map((modifier) => (
                          <option key={modifier.id} value={modifier.id}>
                            {group.name} / {modifier.name}
                          </option>
                        )),
                      )}
                    </select>
                    <label>
                      Effective from
                      <input
                        name="effectiveFrom"
                        type="datetime-local"
                        required
                      />
                    </label>
                    <div className="inventory-component-editor">
                      <strong>Stock effects</strong>
                      {modifierComponents.map((component, index) => (
                        <div className="inventory-component-row" key={index}>
                          <select
                            aria-label={`Modifier inventory item ${index + 1}`}
                            value={component.inventoryItemId}
                            onChange={(event) =>
                              setModifierComponents((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        inventoryItemId: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                            required
                          >
                            <option value="">Inventory item</option>
                            {data?.items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Modifier effect kind ${index + 1}`}
                            value={component.kind}
                            onChange={(event) =>
                              setModifierComponents((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        kind: event.target
                                          .value as ModifierComponentInput["kind"],
                                      }
                                    : row,
                                ),
                              )
                            }
                          >
                            <option value="ADD">ADD</option>
                            <option value="REMOVE">REMOVE</option>
                            <option value="REPLACE_ADD">REPLACE_ADD</option>
                            <option value="REPLACE_REMOVE">
                              REPLACE_REMOVE
                            </option>
                          </select>
                          <input
                            aria-label={`Modifier effect quantity ${index + 1}`}
                            inputMode="numeric"
                            pattern="[1-9][0-9]{0,18}"
                            placeholder="Micros"
                            value={component.quantityMicros}
                            onChange={(event) =>
                              setModifierComponents((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        quantityMicros: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                            required
                          />
                          <button
                            type="button"
                            disabled={modifierComponents.length === 1}
                            onClick={() =>
                              setModifierComponents((rows) =>
                                rows.filter(
                                  (_, rowIndex) => rowIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setModifierComponents((rows) => [
                            ...rows,
                            {
                              inventoryItemId: "",
                              kind: "ADD",
                              quantityMicros: "",
                            },
                          ])
                        }
                      >
                        Add stock effect
                      </button>
                    </div>
                    <textarea name="reason" placeholder="Reason" required />
                    <button disabled={busy}>Create draft effect</button>
                  </form>
                </article>
              </>
            )}
          </aside>
        </section>
      ) : null}

      {view === "operations" ? (
        <InventoryOperations session={session} notify={notify} />
      ) : null}

      {view === "balances" ? (
        <section className="inventory-balance-grid">
          <article className="live-list-card">
            <header>
              <strong>Current balances</strong>
              <span>1 base unit = 1,000,000 micros</span>
            </header>
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Item</th>
                    <th>Exact quantity</th>
                    <th>Micros</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.locations ?? []).flatMap((location) =>
                    (data?.items ?? []).map((item) => {
                      const quantity =
                        balances.get(`${location.id}:${item.id}`) ?? "0";
                      return (
                        <tr key={`${location.id}:${item.id}`}>
                          <td>{location.name}</td>
                          <td>{item.name}</td>
                          <td>{formatMicros(quantity, item.baseUnit.code)}</td>
                          <td>{quantity}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            {!data?.locations.length || !data.items.length ? (
              <p className="live-empty">
                Create a location and item to establish balances.
              </p>
            ) : null}
          </article>
          <aside className="config-card compact-form-card inventory-adjustment">
            <p className="live-eyebrow">Append-only entry</p>
            <h2>Post stock movement</h2>
            {canWrite ? (
              <form className="live-form" onSubmit={adjustmentCreate}>
                <select name="locationId" aria-label="Stock location" required>
                  <option value="">Location</option>
                  {data?.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <select
                  name="inventoryItemId"
                  aria-label="Inventory item"
                  required
                >
                  <option value="">Item</option>
                  {data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select name="type" aria-label="Stock movement type">
                  <option value="OPENING_BALANCE">OPENING_BALANCE</option>
                  <option value="MANUAL_ADJUSTMENT">MANUAL_ADJUSTMENT</option>
                  <option value="WASTE">WASTE</option>
                </select>
                <input
                  name="quantityDeltaMicros"
                  inputMode="numeric"
                  pattern="-?[1-9][0-9]{0,18}"
                  placeholder="Signed quantity in micros"
                  required
                />
                <p>
                  Waste must be negative. Negative-stock overrides stay disabled
                  until owner policy is confirmed.
                </p>
                <textarea name="reason" placeholder="Reason" required />
                <button disabled={busy}>Post immutable entry</button>
              </form>
            ) : (
              <p className="live-empty">inventory.write is required.</p>
            )}
          </aside>
        </section>
      ) : null}

      {view === "ledger" ? (
        <article className="live-list-card inventory-ledger">
          <header>
            <strong>Immutable stock ledger</strong>
            <span>{data?.ledger.length ?? 0} recent entries</span>
          </header>
          <div className="live-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Occurred</th>
                  <th>Location / item</th>
                  <th>Type</th>
                  <th>Delta</th>
                  <th>Actor</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data?.ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {new Date(entry.occurredAt).toLocaleString("en-GH", {
                        timeZone: "Africa/Accra",
                      })}
                    </td>
                    <td>
                      {entry.location.name}
                      <small>{entry.inventoryItem.name}</small>
                    </td>
                    <td>{entry.type}</td>
                    <td>
                      {formatMicros(
                        entry.quantityDeltaMicros,
                        entry.inventoryItem.baseUnit.code,
                      )}
                    </td>
                    <td>{entry.actorDisplayName}</td>
                    <td>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data?.ledger.length ? (
            <p className="live-empty">No stock ledger entries exist.</p>
          ) : null}
        </article>
      ) : null}

      {view === "policies" ? (
        <InventoryPolicies session={session} notify={notify} />
      ) : null}
    </section>
  );
}
