"use client";

import { formatMoney, money } from "@base-cafe/domain";
import { Brand, Icon, type IconName } from "@base-cafe/ui";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useMemo, useRef, useState } from "react";

type CatalogStatus = "Active" | "Draft" | "Unavailable";

type CatalogItem = {
  id: string;
  name: string;
  code: string;
  category: string;
  priceMinor: number;
  station: "Kitchen" | "Bar";
  status: CatalogStatus;
  updated: string;
  image: string;
};

const initialItems: readonly CatalogItem[] = [
  {
    id: "burger",
    name: "Demo Smash Burger",
    code: "DEMO-BURGER-01",
    category: "Burgers",
    priceMinor: 5600,
    station: "Kitchen",
    status: "Active",
    updated: "2 min ago",
    image: "/menu/demo-burger.png",
  },
  {
    id: "ginger",
    name: "Demo Ginger Cooler",
    code: "DEMO-GINGER-01",
    category: "Drinks",
    priceMinor: 2200,
    station: "Bar",
    status: "Active",
    updated: "8 min ago",
    image: "/menu/demo-ginger.png",
  },
  {
    id: "pizza",
    name: "Demo Garden Pizza",
    code: "DEMO-PIZZA-01",
    category: "Pizza",
    priceMinor: 7200,
    station: "Kitchen",
    status: "Draft",
    updated: "24 min ago",
    image: "/menu/demo-pizza.png",
  },
  {
    id: "wings",
    name: "Demo Spiced Wings",
    code: "DEMO-WINGS-01",
    category: "Sides",
    priceMinor: 4400,
    station: "Kitchen",
    status: "Unavailable",
    updated: "1 hr ago",
    image: "/menu/demo-wings.png",
  },
  {
    id: "citrus",
    name: "Demo Citrus Fizz",
    code: "DEMO-CITRUS-01",
    category: "Drinks",
    priceMinor: 2400,
    station: "Bar",
    status: "Active",
    updated: "Yesterday",
    image: "/menu/demo-citrus.png",
  },
];

const navItems: readonly { icon: IconName; label: string }[] = [
  { icon: "grid", label: "Overview" },
  { icon: "bag", label: "Catalog" },
  { icon: "users", label: "Staff & roles" },
  { icon: "monitor", label: "Devices" },
  { icon: "audit", label: "Security & audit" },
  { icon: "shift", label: "Pilot readiness" },
  { icon: "upload", label: "Imports" },
];

export function CatalogShell() {
  const [items, setItems] = useState<CatalogItem[]>([...initialItems]);
  const [selectedId, setSelectedId] = useState("burger");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [status, setStatus] = useState("All statuses");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  const visibleItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        normalized.length === 0 ||
        `${item.name} ${item.category} ${item.code}`
          .toLocaleLowerCase()
          .includes(normalized);
      const matchesCategory =
        category === "All categories" || item.category === category;
      const matchesStatus = status === "All statuses" || item.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [category, deferredQuery, items, status]);

  const selectedItem =
    items.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;

  function deactivateSelected() {
    if (!selectedItem) {
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.id === selectedItem.id
          ? { ...item, status: "Unavailable", updated: "Just now" }
          : item,
      ),
    );
    setNotice(`${selectedItem.name} marked unavailable in demo state`);
  }

  function createDemoItem(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const itemCategory = String(formData.get("category") ?? "Meals");
    const price = Number(formData.get("price") ?? 0);
    if (!name || !Number.isFinite(price) || price <= 0) {
      setNotice("Enter a name and a positive demo price");
      return;
    }
    const id = `local-${Date.now()}`;
    const nextItem: CatalogItem = {
      id,
      name,
      code: `DEMO-${id.slice(-5)}`,
      category: itemCategory,
      priceMinor: Math.round(price * 100),
      station: "Kitchen",
      status: "Draft",
      updated: "Just now",
      image: "/menu/demo-jollof.png",
    };
    setItems((current) => [nextItem, ...current]);
    setSelectedId(id);
    setNewItemOpen(false);
    setNotice(`${name} created as a local draft`);
  }

  return (
    <main className="admin-app">
      <header className="admin-topbar">
        <Brand label="Base Cafe Admin" />
        <button className="branch-select" type="button">
          <Icon name="grid" size={20} />
          <span>KNUST · Main Branch</span>
          <Icon name="chevron" size={18} />
        </button>
        <div className="admin-topbar__spacer" />
        <div className="system-state">
          <span />
          All systems operational
        </div>
        <div className="top-divider" />
        <div className="clock">
          <Icon name="clock" size={21} />
          11:24 AM
        </div>
        <div className="top-divider" />
        <button className="admin-user" type="button">
          <span className="admin-user__avatar">
            <Icon name="user" size={23} />
          </span>
          <span>
            <strong>Kwame Boateng</strong>
            <small>Manager</small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      </header>

      <nav className="admin-nav" aria-label="Admin navigation">
        <div className="admin-nav__items">
          {navItems.map((item) =>
            item.label === "Security & audit" ||
            item.label === "Pilot readiness" ? (
              <Link
                href={
                  item.label === "Security & audit" ? "/security" : "/readiness"
                }
                key={item.label}
              >
                <Icon name={item.icon} size={22} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <button
                aria-current={item.label === "Catalog" ? "page" : undefined}
                className={item.label === "Catalog" ? "is-active" : ""}
                key={item.label}
                onClick={() =>
                  item.label === "Catalog"
                    ? undefined
                    : setNotice(
                        `${item.label} shell is ready for the next milestone`,
                      )
                }
                type="button"
              >
                <Icon name={item.icon} size={22} />
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
        <button className="admin-collapse" type="button">
          <span aria-hidden="true">‹</span>
          Collapse
        </button>
      </nav>

      <section className="catalog-content">
        <div className="catalog-heading">
          <h1>Menu items</h1>
          <p>Manage demo catalog items, pricing and station routing.</p>
        </div>

        <div className="catalog-tools">
          <label className="search-control">
            <Icon name="search" size={21} />
            <input
              aria-label="Search items"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search items"
              type="search"
              value={query}
            />
          </label>
          <label className="select-control">
            <span className="sr-only">Category</span>
            <select
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option>All categories</option>
              <option>Burgers</option>
              <option>Drinks</option>
              <option>Pizza</option>
              <option>Sides</option>
              <option>Meals</option>
            </select>
          </label>
          <label className="select-control">
            <span className="sr-only">Status</span>
            <select
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option>All statuses</option>
              <option>Active</option>
              <option>Draft</option>
              <option>Unavailable</option>
            </select>
          </label>
          <input
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setNotice(
                  `${file.name} selected · dry-run API not connected yet`,
                );
              }
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="tool-button"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Icon name="upload" size={20} />
            Import CSV
          </button>
          <button
            className="tool-button tool-button--primary"
            onClick={() => setNewItemOpen(true)}
            type="button"
          >
            New item
            <Icon name="plus" size={19} />
          </button>
        </div>

        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Price</th>
                <th>Station</th>
                <th>Status</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  className={selectedItem?.id === item.id ? "is-selected" : ""}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td>
                    <button className="item-cell" type="button">
                      <span className="item-thumb">
                        <Image alt="" fill sizes="48px" src={item.image} />
                      </span>
                      <span>{item.name}</span>
                    </button>
                  </td>
                  <td>{item.category}</td>
                  <td>{formatMoney(money(item.priceMinor))}</td>
                  <td>{item.station}</td>
                  <td>
                    <span
                      className={`status-text status-text--${item.status.toLowerCase()}`}
                    >
                      <span aria-hidden="true">
                        {item.status === "Active"
                          ? "✓"
                          : item.status === "Draft"
                            ? "□"
                            : "−"}
                      </span>
                      {item.status}
                    </span>
                  </td>
                  <td>{item.updated}</td>
                  <td>
                    <button
                      aria-label={`More actions for ${item.name}`}
                      className="more-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setNotice(`Actions opened for ${item.name}`);
                      }}
                      type="button"
                    >
                      <Icon name="more" size={21} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleItems.length === 0 ? (
            <div className="catalog-empty">
              <Icon name="search" size={30} />
              <strong>No matching menu items</strong>
              <span>Clear a filter or search for another demo item.</span>
            </div>
          ) : null}
        </div>
        <p className="demo-data-note">
          Fictional demo data — replace before production.
        </p>
      </section>

      <aside className="item-inspector" aria-label="Selected item details">
        {selectedItem ? (
          <>
            <div className="inspector-heading">
              <h2>{selectedItem.name}</h2>
              <button aria-label="Close inspector" type="button">
                ×
              </button>
            </div>
            <dl>
              <div>
                <dt>Internal code</dt>
                <dd>
                  {selectedItem.code}
                  <button
                    aria-label="Copy internal code"
                    onClick={() =>
                      setNotice(`${selectedItem.code} copied for demo`)
                    }
                    type="button"
                  >
                    <Icon name="orders" size={17} />
                  </button>
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{selectedItem.category}</dd>
              </div>
              <div>
                <dt>Base price</dt>
                <dd>{formatMoney(money(selectedItem.priceMinor))}</dd>
              </div>
              <div>
                <dt>Station</dt>
                <dd>{selectedItem.station}</dd>
              </div>
              <div>
                <dt>Tax class</dt>
                <dd>Demo — not configured</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd className="availability">
                  <span aria-hidden="true">
                    {selectedItem.status === "Unavailable" ? "−" : "✓"}
                  </span>
                  {selectedItem.status === "Unavailable"
                    ? "Unavailable"
                    : "Available"}
                </dd>
              </div>
            </dl>
            <div className="inspector-actions">
              <button
                onClick={() => setNotice("Edit form is ready for API wiring")}
                type="button"
              >
                <span aria-hidden="true">✎</span>
                Edit item
              </button>
              <button onClick={deactivateSelected} type="button">
                <span aria-hidden="true">−</span>
                Deactivate
              </button>
            </div>
            <p className="audit-note">
              <Icon name="clock" size={18} />
              Last changed by Kwame Boateng · {selectedItem.updated}
            </p>
          </>
        ) : (
          <div className="inspector-empty">
            <Icon name="bag" size={30} />
            <span>Select a menu item</span>
          </div>
        )}
      </aside>

      {notice ? (
        <div className="admin-toast" role="status">
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

      {newItemOpen ? (
        <div className="modal-backdrop">
          <form
            action={createDemoItem}
            aria-labelledby="new-item-title"
            aria-modal="true"
            className="new-item-modal"
            role="dialog"
          >
            <div className="new-item-modal__header">
              <div>
                <span>Fictional demo catalog</span>
                <h2 id="new-item-title">Create menu item</h2>
              </div>
              <button
                aria-label="Close new item form"
                onClick={() => setNewItemOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <label>
              Item name
              <input
                autoFocus
                name="name"
                placeholder="Demo item name"
                required
              />
            </label>
            <div className="form-grid">
              <label>
                Category
                <select defaultValue="Meals" name="category">
                  <option>Meals</option>
                  <option>Burgers</option>
                  <option>Pizza</option>
                  <option>Sides</option>
                  <option>Drinks</option>
                </select>
              </label>
              <label>
                Base price (GHS)
                <input
                  min="0.01"
                  name="price"
                  placeholder="0.00"
                  required
                  step="0.01"
                />
              </label>
            </div>
            <p>
              New items remain Draft and use local demo state until the API is
              connected.
            </p>
            <div className="modal-actions">
              <button onClick={() => setNewItemOpen(false)} type="button">
                Cancel
              </button>
              <button type="submit">Create draft</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
