"use client";

import {
  menuImportV1Headers,
  type CategoryResponse,
  type MenuImportDryRunResponse,
  type MenuItemConfigurationResponse,
  type ModifierGroupResponse,
  type StationResponse,
  type TaxClassResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  activateMenuVariant,
  activateTaxClass,
  applyMenuImport,
  attachModifierGroup,
  changeMenuItemStatus,
  createCategory,
  createMenuItem,
  createMenuPrice,
  createMenuVariant,
  createModifierGroup,
  createTaxClass,
  dryRunMenuImport,
  listCategories,
  listMenuItems,
  listModifierGroups,
  listStations,
  listTaxClasses,
  updateMenuItemName,
  type AdminSession,
} from "./admin-client";

type Section = "items" | "modifiers" | "import";

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "The request failed.";
}

function minorFromGhs(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new Error("Enter a non-negative GHS amount with at most 2 decimals.");
  const amount =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Price must be a positive safe integer-pesewa amount.");
  }
  return amount;
}

function formatMoney(amountMinor: number) {
  return `GH₵${(amountMinor / 100).toFixed(2)}`;
}

function reasonFor(action: string) {
  return window.prompt(`Reason for ${action} (required):`)?.trim() ?? "";
}

function downloadTemplate() {
  const blob = new Blob([`${menuImportV1Headers.join(",")}\r\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "menu-v1-empty-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CatalogConfiguration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("items");
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [taxClasses, setTaxClasses] = useState<TaxClassResponse[]>([]);
  const [stations, setStations] = useState<StationResponse[]>([]);
  const [items, setItems] = useState<MenuItemConfigurationResponse[]>([]);
  const [groups, setGroups] = useState<ModifierGroupResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("menu-import.csv");
  const [dryRun, setDryRun] = useState<MenuImportDryRunResponse | null>(null);
  const [importTarget, setImportTarget] = useState({
    branchCode: "",
    menuCode: "",
  });
  const [importReason, setImportReason] = useState("");
  const has = (permission: string) =>
    session.user.permissions.includes(permission);

  const load = useCallback(async () => {
    try {
      const [
        nextCategories,
        nextTaxClasses,
        nextStations,
        nextItems,
        nextGroups,
      ] = await Promise.all([
        listCategories(session),
        listTaxClasses(session),
        listStations(session),
        listMenuItems(session),
        listModifierGroups(session),
      ]);
      setCategories(nextCategories);
      setTaxClasses(nextTaxClasses);
      setStations(nextStations);
      setItems(nextItems);
      setGroups(nextGroups);
      setDenied(false);
    } catch (error) {
      setDenied(error instanceof ApiError && error.status === 403);
      notify(errorText(error));
    }
  }, [notify, session]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function perform(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await task();
      await load();
      notify(success);
      return true;
    } catch (error) {
      notify(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function categoryCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createCategory(session, {
          externalKey: String(data.get("externalKey") || "") || undefined,
          name: String(data.get("name")),
          description: String(data.get("description") || "") || undefined,
          sortOrder: Number(data.get("sortOrder")),
          reason: String(data.get("reason")),
        }),
      "Catalog category created.",
    );
    if (created) form.reset();
  }

  async function taxClassCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createTaxClass(session, {
          key: String(data.get("key")),
          label: String(data.get("label")),
          treatment: String(
            data.get("treatment"),
          ) as TaxClassResponse["treatment"],
          reason: String(data.get("reason")),
        }),
      "Inactive tax class created.",
    );
    if (created) form.reset();
  }

  async function itemCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createMenuItem(session, {
          externalKey: String(data.get("externalKey") || "") || undefined,
          categoryId: String(data.get("categoryId")),
          defaultStationId: String(data.get("stationId") || "") || undefined,
          taxClassId: String(data.get("taxClassId") || "") || undefined,
          name: String(data.get("name")),
          shortName: String(data.get("shortName") || "") || undefined,
          description: String(data.get("description") || "") || undefined,
          sku: String(data.get("sku") || "") || undefined,
          reason: String(data.get("reason")),
        }),
      "Inactive menu item created.",
    );
    if (created) form.reset();
  }

  async function modifierCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const modifiers = String(data.get("modifiers"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, delta = "0", stationKey = ""] = line
            .split(",")
            .map((cell) => cell.trim());
          if (!name) throw new Error(`Invalid modifier line: ${line}`);
          const station = stationKey
            ? stations.find(
                (candidate) =>
                  candidate.externalKey === stationKey.toUpperCase(),
              )
            : undefined;
          if (stationKey && !station)
            throw new Error(`Unknown station key ${stationKey}.`);
          return {
            name,
            priceDeltaMinor: delta === "0" ? 0 : minorFromGhs(delta),
            stationId: station?.id,
            isAvailable: true,
          };
        });
      const created = await perform(
        () =>
          createModifierGroup(session, {
            name: String(data.get("name")),
            minimum: Number(data.get("minimum")),
            maximum: Number(data.get("maximum")),
            isRequired: data.get("isRequired") === "on",
            freeSelectionCount: Number(data.get("freeSelectionCount")),
            modifiers,
            reason: String(data.get("reason")),
          }),
        "Modifier group and options created.",
      );
      if (created) form.reset();
    } catch (error) {
      notify(errorText(error));
    }
  }

  async function addPrice(
    item: MenuItemConfigurationResponse,
    variant?: MenuItemConfigurationResponse["variants"][number],
  ) {
    const amount = window
      .prompt(`Price in GHS for ${variant?.name ?? item.name}:`)
      ?.trim();
    if (!amount) return;
    const effectiveFrom = window
      .prompt("Effective ISO instant (required):", new Date().toISOString())
      ?.trim();
    if (!effectiveFrom) return;
    const reason = reasonFor(
      `adding an effective price to ${variant?.name ?? item.name}`,
    );
    if (!reason) return;
    await perform(
      () =>
        createMenuPrice(session, {
          menuItemId: item.id,
          menuVariantId: variant?.id,
          amountMinor: minorFromGhs(amount),
          effectiveFrom,
          reason,
        }),
      "Effective price created.",
    );
  }

  async function createVariant(item: MenuItemConfigurationResponse) {
    const name = window.prompt(`Variant name for ${item.name}:`)?.trim();
    if (!name) return;
    const externalKey = window
      .prompt("Variant external key (optional):")
      ?.trim();
    const reason = reasonFor(`creating variant ${name}`);
    if (!reason) return;
    await perform(
      () =>
        createMenuVariant(session, item, {
          name,
          externalKey: externalKey || undefined,
          reason,
        }),
      "Inactive variant created.",
    );
  }

  async function editItem(item: MenuItemConfigurationResponse) {
    const name = window.prompt("Updated item name:", item.name)?.trim();
    if (!name || name === item.name) return;
    const reason = reasonFor(`updating ${item.name}`);
    if (!reason) return;
    await perform(
      () => updateMenuItemName(session, item, name, reason),
      "Menu item revision updated.",
    );
  }

  async function attachGroup(item: MenuItemConfigurationResponse) {
    const name = window
      .prompt(`Modifier group name to attach to ${item.name}:`)
      ?.trim();
    if (!name) return;
    const group = groups.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    if (!group)
      return notify("No modifier group with that exact name was found.");
    const reason = reasonFor(`attaching ${group.name} to ${item.name}`);
    if (!reason) return;
    await perform(
      () =>
        attachModifierGroup(
          session,
          item,
          group,
          item.modifierGroups.length,
          reason,
        ),
      "Modifier group attached.",
    );
  }

  async function runDryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await dryRunMenuImport(session, {
        ...importTarget,
        fileName,
        csvText,
      });
      setDryRun(result);
      notify(
        result.valid
          ? "CSV dry-run is valid; no data was written."
          : "CSV dry-run found row errors; no data was written.",
      );
    } catch (error) {
      setDryRun(null);
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!dryRun?.valid || !importReason.trim()) return;
    setBusy(true);
    try {
      const result = await applyMenuImport(session, {
        ...importTarget,
        fileName,
        csvText,
        validationHash: dryRun.validationHash,
        reason: importReason,
      });
      notify(`Catalog import applied: ${result.applied.itemsUpserted} items.`);
      setDryRun(null);
      setImportReason("");
      await load();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalog-configuration">
      <div className="catalog-tabs" role="tablist">
        {(["items", "modifiers", "import"] as const).map((value) => (
          <button
            key={value}
            className={section === value ? "is-active" : ""}
            onClick={() => setSection(value)}
          >
            {value === "items"
              ? "Items & setup"
              : value === "modifiers"
                ? "Modifiers"
                : "CSV import"}
          </button>
        ))}
      </div>
      {denied ? (
        <p className="config-warning">
          The server denied one or more catalog permissions.
        </p>
      ) : null}

      {section === "items" ? (
        <section className="config-workspace catalog-workspace">
          <article className="config-card">
            <header>
              <div>
                <p className="live-eyebrow">Server-authoritative menu</p>
                <h2>Items, variants & prices</h2>
              </div>
              <span>{items.length} items</span>
            </header>
            <div className="catalog-items">
              {items.map((item) => (
                <section className="catalog-item" key={item.id}>
                  <header>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.externalKey ?? "No external key"} · r
                        {item.revision}
                      </small>
                    </div>
                    <span
                      className={`live-status live-status--${item.isActive ? "active" : "pending"}`}
                    >
                      {item.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </header>
                  <p>
                    {item.category.name} ·{" "}
                    {item.defaultStation?.name ?? "station missing"} ·{" "}
                    {item.taxClass?.label ?? "tax class missing"}
                  </p>
                  <div className="tax-components">
                    {item.prices.map((price) => (
                      <span key={price.id}>
                        {formatMoney(price.amountMinor)} from{" "}
                        {price.effectiveFrom.slice(0, 10)}
                      </span>
                    ))}
                  </div>
                  {item.variants.map((variant) => (
                    <div className="variant-row" key={variant.id}>
                      <span>
                        {variant.name} · r{variant.revision} ·{" "}
                        {variant.isActive ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span>
                        {variant.prices
                          .map((price) => formatMoney(price.amountMinor))
                          .join(", ") || "No exact price"}
                      </span>
                      {has("catalog.write") ? (
                        <>
                          <button onClick={() => void addPrice(item, variant)}>
                            Add price
                          </button>
                          {!variant.isActive ? (
                            <button
                              onClick={() => {
                                const reason = reasonFor(
                                  `activating ${variant.name}`,
                                );
                                if (reason)
                                  void perform(
                                    () =>
                                      activateMenuVariant(
                                        session,
                                        item,
                                        variant,
                                        reason,
                                      ),
                                    "Variant activated.",
                                  );
                              }}
                            >
                              Activate
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}
                  {has("catalog.write") ? (
                    <footer>
                      <button onClick={() => void editItem(item)}>
                        Edit name
                      </button>
                      <button onClick={() => void addPrice(item)}>
                        Add base price
                      </button>
                      <button onClick={() => void createVariant(item)}>
                        Add variant
                      </button>
                      <button onClick={() => void attachGroup(item)}>
                        Attach modifier
                      </button>
                      <button
                        onClick={() => {
                          const action = item.isActive
                            ? "deactivate"
                            : "activate";
                          const reason = reasonFor(`${action} ${item.name}`);
                          if (reason)
                            void perform(
                              () =>
                                changeMenuItemStatus(
                                  session,
                                  item,
                                  action,
                                  reason,
                                ),
                              `Menu item ${action}d.`,
                            );
                        }}
                      >
                        {item.isActive
                          ? "Deactivate"
                          : "Activate when complete"}
                      </button>
                    </footer>
                  ) : null}
                </section>
              ))}
              {items.length === 0 ? (
                <p className="live-empty">No menu items configured.</p>
              ) : null}
            </div>
          </article>

          <aside className="config-stack">
            {has("catalog.write") ? (
              <>
                <article className="config-card config-form-card compact-form-card">
                  <p className="live-eyebrow">New menu record</p>
                  <h2>Create inactive item</h2>
                  <form className="live-form" onSubmit={itemCreate}>
                    <input
                      name="name"
                      aria-label="Item name"
                      placeholder="Item name"
                      required
                    />
                    <input
                      name="externalKey"
                      aria-label="Item external key"
                      placeholder="External key"
                    />
                    <div className="split-fields">
                      <select
                        name="categoryId"
                        aria-label="Item category"
                        required
                        defaultValue=""
                      >
                        <option value="">Category</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name="stationId"
                        aria-label="Default station"
                        defaultValue=""
                      >
                        <option value="">Station later</option>
                        {stations
                          .filter((station) => station.isActive)
                          .map((station) => (
                            <option key={station.id} value={station.id}>
                              {station.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <select
                      name="taxClassId"
                      aria-label="Tax class"
                      defaultValue=""
                    >
                      <option value="">Tax class later</option>
                      {taxClasses.map((taxClass) => (
                        <option key={taxClass.id} value={taxClass.id}>
                          {taxClass.label} (
                          {taxClass.isActive ? "ACTIVE" : "INACTIVE"})
                        </option>
                      ))}
                    </select>
                    <input
                      name="shortName"
                      aria-label="Short name"
                      placeholder="Short name (optional)"
                    />
                    <input
                      name="sku"
                      aria-label="SKU"
                      placeholder="SKU (optional)"
                    />
                    <textarea
                      name="description"
                      aria-label="Item description"
                      placeholder="Description (optional)"
                    />
                    <textarea
                      name="reason"
                      aria-label="Item creation reason"
                      placeholder="Reason"
                      required
                    />
                    <button className="live-primary" disabled={busy}>
                      Create inactive item
                    </button>
                  </form>
                </article>
                <article className="config-card config-form-card compact-form-card">
                  <p className="live-eyebrow">Menu grouping</p>
                  <h2>Create category</h2>
                  <form className="live-form" onSubmit={categoryCreate}>
                    <input
                      name="name"
                      aria-label="Category name"
                      placeholder="Name"
                      required
                    />
                    <input
                      name="externalKey"
                      aria-label="Category external key"
                      placeholder="External key"
                    />
                    <input
                      name="sortOrder"
                      aria-label="Category sort order"
                      type="number"
                      min="0"
                      defaultValue="0"
                      required
                    />
                    <textarea
                      name="description"
                      aria-label="Category description"
                      placeholder="Description (optional)"
                    />
                    <textarea
                      name="reason"
                      aria-label="Category creation reason"
                      placeholder="Reason"
                      required
                    />
                    <button disabled={busy}>Create category</button>
                  </form>
                </article>
                <article className="config-card config-form-card compact-form-card">
                  <p className="live-eyebrow">Item treatment</p>
                  <h2>Tax classes</h2>
                  <div className="tax-components">
                    {taxClasses.map((taxClass) => (
                      <button
                        key={taxClass.id}
                        disabled={
                          taxClass.isActive || busy || !has("tax.configure")
                        }
                        onClick={() => {
                          const reason = reasonFor(
                            `activating tax class ${taxClass.label}`,
                          );
                          if (reason)
                            void perform(
                              () => activateTaxClass(session, taxClass, reason),
                              "Tax class activated.",
                            );
                        }}
                      >
                        {taxClass.label} · {taxClass.treatment} ·{" "}
                        {taxClass.isActive ? "ACTIVE" : "activate"}
                      </button>
                    ))}
                  </div>
                  {has("tax.configure") ? (
                    <form className="live-form" onSubmit={taxClassCreate}>
                      <input
                        name="key"
                        aria-label="Tax class key"
                        placeholder="Key"
                        required
                      />
                      <input
                        name="label"
                        aria-label="Tax class label"
                        placeholder="Label"
                        required
                      />
                      <select name="treatment" aria-label="Tax treatment">
                        <option value="STANDARD">STANDARD</option>
                        <option value="ZERO_RATED">ZERO_RATED</option>
                        <option value="EXEMPT">EXEMPT</option>
                        <option value="OUT_OF_SCOPE">OUT_OF_SCOPE</option>
                      </select>
                      <textarea
                        name="reason"
                        aria-label="Tax class creation reason"
                        placeholder="Reason"
                        required
                      />
                      <button disabled={busy}>Create inactive class</button>
                    </form>
                  ) : null}
                </article>
              </>
            ) : null}
          </aside>
        </section>
      ) : null}

      {section === "modifiers" ? (
        <section className="config-workspace">
          <article className="config-card">
            <header>
              <div>
                <p className="live-eyebrow">Selection policy</p>
                <h2>Modifier groups</h2>
              </div>
              <span>{groups.length} groups</span>
            </header>
            <div className="catalog-items">
              {groups.map((group) => (
                <section className="catalog-item" key={group.id}>
                  <header>
                    <div>
                      <strong>{group.name}</strong>
                      <small>
                        min {group.minimum} · max {group.maximum} · free{" "}
                        {group.freeSelectionCount}
                      </small>
                    </div>
                  </header>
                  <div className="tax-components">
                    {group.modifiers.map((modifier) => (
                      <span key={modifier.id}>
                        {modifier.name}{" "}
                        {modifier.priceDeltaMinor
                          ? `+${formatMoney(modifier.priceDeltaMinor)}`
                          : "included"}
                      </span>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </article>
          {has("catalog.write") ? (
            <aside className="config-card config-form-card">
              <p className="live-eyebrow">New group</p>
              <h2>Create modifiers</h2>
              <form className="live-form" onSubmit={modifierCreate}>
                <input
                  name="name"
                  aria-label="Modifier group name"
                  placeholder="Group name"
                  required
                />
                <div className="split-fields">
                  <label>
                    Minimum
                    <input
                      name="minimum"
                      type="number"
                      min="0"
                      defaultValue="0"
                      required
                    />
                  </label>
                  <label>
                    Maximum
                    <input
                      name="maximum"
                      type="number"
                      min="1"
                      defaultValue="1"
                      required
                    />
                  </label>
                </div>
                <label>
                  Free selections
                  <input
                    name="freeSelectionCount"
                    type="number"
                    min="0"
                    defaultValue="0"
                    required
                  />
                </label>
                <label className="check-row">
                  <input name="isRequired" type="checkbox" /> Required group
                </label>
                <label>
                  Options
                  <textarea
                    name="modifiers"
                    placeholder={
                      "Name,delta GHS,station key (optional)\nNo ice,0,"
                    }
                    required
                  />
                </label>
                <p className="field-note">
                  Mixed-price free-selection behavior remains blocked at
                  ordering until owner policy is confirmed.
                </p>
                <label>
                  Reason
                  <textarea name="reason" required />
                </label>
                <button className="live-primary" disabled={busy}>
                  Create group
                </button>
              </form>
            </aside>
          ) : null}
        </section>
      ) : null}

      {section === "import" ? (
        <section className="config-workspace">
          <article className="config-card config-form-card">
            <p className="live-eyebrow">Validate before writing</p>
            <h2>Menu CSV dry-run</h2>
            <form className="live-form" onSubmit={runDryRun}>
              <div className="split-fields">
                <label>
                  Branch code
                  <input
                    value={importTarget.branchCode}
                    onChange={(event) =>
                      setImportTarget({
                        ...importTarget,
                        branchCode: event.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Menu code
                  <input
                    value={importTarget.menuCode}
                    onChange={(event) =>
                      setImportTarget({
                        ...importTarget,
                        menuCode: event.target.value,
                      })
                    }
                    required
                  />
                </label>
              </div>
              <label>
                CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setFileName(file.name);
                      void file.text().then(setCsvText);
                    }
                  }}
                />
              </label>
              <label>
                CSV content
                <textarea
                  className="csv-editor"
                  value={csvText}
                  onChange={(event) => {
                    setCsvText(event.target.value);
                    setDryRun(null);
                  }}
                  required
                />
              </label>
              <div className="form-actions">
                <button
                  className="live-primary"
                  disabled={busy || !has("catalog.import")}
                >
                  Run dry-run (no writes)
                </button>
                <button type="button" onClick={downloadTemplate}>
                  Download empty template
                </button>
              </div>
            </form>
          </article>
          <aside className="config-card config-form-card">
            <p className="live-eyebrow">Deterministic result</p>
            <h2>Row validation</h2>
            {dryRun ? (
              <>
                <div
                  className={`import-summary ${dryRun.valid ? "is-valid" : "is-invalid"}`}
                >
                  <strong>{dryRun.valid ? "VALID" : "BLOCKED"}</strong>
                  <span>
                    {dryRun.summary.dataRows} rows · {dryRun.summary.errors}{" "}
                    errors · {dryRun.summary.warnings} warnings
                  </span>
                </div>
                <div className="import-issues">
                  {dryRun.issues.map((issue, index) => (
                    <div key={`${issue.row}-${issue.field}-${index}`}>
                      <b>
                        Row {issue.row} · {issue.field}
                      </b>
                      <span>
                        {issue.code}: {issue.message}
                      </span>
                    </div>
                  ))}
                </div>
                {dryRun.valid ? (
                  <div className="live-form">
                    <label>
                      Apply reason
                      <textarea
                        value={importReason}
                        onChange={(event) =>
                          setImportReason(event.target.value)
                        }
                        required
                      />
                    </label>
                    <button
                      className="live-primary"
                      disabled={busy || !importReason.trim()}
                      onClick={() => void applyImport()}
                    >
                      Apply exact validated CSV
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="live-empty">
                Run validation to see detailed row errors. No file is applied
                during dry-run.
              </p>
            )}
          </aside>
        </section>
      ) : null}
    </div>
  );
}
