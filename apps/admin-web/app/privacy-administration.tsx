"use client";

import type {
  CustomerConsentResponse,
  CustomerResponse,
  PrivacyRequestResponse,
  RetentionPolicyResponse,
  RetentionPreviewResponse,
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
  createCustomerPrivacyRequest,
  createCustomerProfile,
  createRetentionPolicy,
  exportCustomerData,
  listCustomerConsents,
  listPrivacyRequests,
  listRetentionPolicies,
  previewRetentionPolicy,
  recordCustomerConsent,
  searchCustomers,
  transitionCustomerPrivacyRequest,
  type AdminSession,
} from "./admin-client";

type View = "customers" | "requests" | "retention";

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The privacy request could not be completed.";
}

function iso(value: FormDataEntryValue | null) {
  return new Date(String(value)).toISOString();
}

function nextStatuses(request: PrivacyRequestResponse) {
  if (request.status === "RECEIVED")
    return ["IDENTITY_VERIFIED", "REJECTED", "CANCELLED"] as const;
  if (request.status === "IDENTITY_VERIFIED")
    return ["IN_PROGRESS", "REJECTED", "CANCELLED"] as const;
  if (request.status === "IN_PROGRESS")
    return ["COMPLETED", "REJECTED"] as const;
  return [] as const;
}

export function PrivacyAdministration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<View>("customers");
  const [requests, setRequests] = useState<PrivacyRequestResponse[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicyResponse[]>([]);
  const [customers, setCustomers] = useState<CustomerResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [consents, setConsents] = useState<CustomerConsentResponse[]>([]);
  const [preview, setPreview] = useState<RetentionPreviewResponse | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "denied" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const permissions = session.user.permissions;
  const canReadRequests = permissions.includes("privacy.requests.read");
  const canReadPolicies = permissions.includes("privacy.policies.read");
  const canCreateCustomer = permissions.includes("customers.create");
  const canReadCustomer =
    permissions.includes("customers.read") &&
    permissions.includes("customers.pii.read");
  const canManageCustomer = permissions.includes("customers.manage");
  const canManageRequests = permissions.includes("privacy.requests.manage");
  const canManagePolicies = permissions.includes("privacy.policies.manage");
  const canExport = permissions.includes("customer-data.export");

  const load = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      const [requestRows, policyRows] = await Promise.all([
        canReadRequests ? listPrivacyRequests(session) : Promise.resolve([]),
        canReadPolicies ? listRetentionPolicies(session) : Promise.resolve([]),
      ]);
      setRequests(requestRows);
      setPolicies(policyRows);
      setStatus("ready");
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 403 ? "denied" : "error",
      );
      setMessage(messageFor(error));
    }
  }, [canReadPolicies, canReadRequests, session]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
    };
  }, [load]);

  const selected = useMemo(
    () => customers.find((customer) => customer.id === selectedId) ?? null,
    [customers, selectedId],
  );

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

  async function customerCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createCustomerProfile(session, {
            displayName: String(values.get("displayName")) || undefined,
            phone: String(values.get("phone")) || undefined,
            email: String(values.get("email")) || undefined,
            notes: String(values.get("notes")) || undefined,
            preferredContactChannel:
              (String(values.get("preferredContactChannel")) as
                "PHONE" | "SMS" | "EMAIL" | "WHATSAPP") || undefined,
            reason: String(values.get("reason")),
          }),
        "Encrypted customer profile created; PII was not returned by the mutation.",
      )
    )
      form.reset();
  }

  async function customerSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const rows = await searchCustomers(session, {
        phone: String(values.get("phone")) || undefined,
        email: String(values.get("email")) || undefined,
        reason: String(values.get("reason")),
      });
      setCustomers(rows);
      setSelectedId(rows[0]?.id ?? null);
      setConsents(
        rows[0] ? await listCustomerConsents(session, rows[0].id) : [],
      );
      notify(
        `${rows.length} exact encrypted-profile match${rows.length === 1 ? "" : "es"}.`,
      );
    } catch (error) {
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function selectCustomer(customer: CustomerResponse) {
    setSelectedId(customer.id);
    try {
      setConsents(await listCustomerConsents(session, customer.id));
    } catch (error) {
      notify(messageFor(error));
    }
  }

  async function consentRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          recordCustomerConsent(session, selected.id, {
            purpose: String(values.get("purpose")) as
              "OPERATIONAL_CONTACT" | "MARKETING",
            channel: String(values.get("channel")) as
              "PHONE" | "SMS" | "EMAIL" | "WHATSAPP",
            status: String(values.get("status")) as "GRANTED" | "WITHDRAWN",
            source: String(values.get("source")),
            wordingVersion: String(values.get("wordingVersion")),
            occurredAt: iso(values.get("occurredAt")),
            reason: String(values.get("reason")),
          }),
        "Consent event appended without rewriting prior history.",
      )
    ) {
      setConsents(await listCustomerConsents(session, selected.id));
      form.reset();
    }
  }

  async function privacyRequestCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createCustomerPrivacyRequest(session, selected.id, {
            requestType: String(values.get("requestType")) as
              "ACCESS" | "CORRECTION" | "RESTRICTION" | "ANONYMIZATION",
            dueAt: values.get("dueAt") ? iso(values.get("dueAt")) : undefined,
            reason: String(values.get("reason")),
          }),
        "Privacy request created with an immutable RECEIVED event.",
      )
    )
      form.reset();
  }

  async function requestTransition(
    event: FormEvent<HTMLFormElement>,
    request: PrivacyRequestResponse,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          transitionCustomerPrivacyRequest(
            session,
            request,
            String(values.get("status")) as
              | "IDENTITY_VERIFIED"
              | "IN_PROGRESS"
              | "COMPLETED"
              | "REJECTED"
              | "CANCELLED",
            String(values.get("reason")),
          ),
        "Privacy request transitioned with retained event history.",
      )
    )
      form.reset();
  }

  async function exportSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const reason = String(new FormData(event.currentTarget).get("reason"));
    setBusy(true);
    try {
      const payload = await exportCustomerData(session, selected.id, reason);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `customer-access-${selected.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Customer access export generated and audited in memory.");
    } catch (error) {
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function retentionCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await perform(
        () =>
          createRetentionPolicy(session, {
            category: String(values.get("category")) as
              "CUSTOMER_PROFILE" | "ORDER_CONTACT" | "DELIVERY_DIRECTIONS",
            version: Number(values.get("version")),
            durationDays: Number(values.get("durationDays")),
            reason: String(values.get("reason")),
          }),
        "Draft retention policy created; activation remains disabled.",
      )
    )
      form.reset();
  }

  async function retentionPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      setPreview(
        await previewRetentionPolicy(
          session,
          String(values.get("policyId")),
          iso(values.get("asOf")),
          String(values.get("reason")),
        ),
      );
      notify("Non-destructive retention preview generated and audited.");
    } catch (error) {
      notify(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  if (status !== "ready") {
    return (
      <section className="live-panel live-panel--state">
        <strong>
          {status === "loading"
            ? "Loading privacy controls…"
            : "Privacy controls unavailable"}
        </strong>
        <p>{message || "Loading protected organization privacy records."}</p>
      </section>
    );
  }

  return (
    <section className="live-page privacy-page">
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Encrypted customer-data controls</p>
          <h1>Privacy</h1>
          <p>
            Use exact protected search, explicit access reasons and append-only
            consent/request history.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          Refresh privacy
        </button>
      </header>
      <section className="live-metrics">
        <article>
          <span>Search results</span>
          <strong>{customers.length}</strong>
        </article>
        <article>
          <span>Privacy requests</span>
          <strong>{requests.length}</strong>
        </article>
        <article>
          <span>Retention drafts</span>
          <strong>
            {policies.filter((policy) => policy.status === "DRAFT").length}
          </strong>
        </article>
        <article>
          <span>Execution enabled</span>
          <strong>No</strong>
        </article>
      </section>
      <nav className="live-tabs" aria-label="Privacy dataset">
        {(["customers", "requests", "retention"] as const).map((name) => (
          <button
            key={name}
            className={view === name ? "is-active" : ""}
            onClick={() => setView(name)}
          >
            {name === "customers"
              ? "Customers & consent"
              : name === "requests"
                ? "Privacy requests"
                : "Retention"}
          </button>
        ))}
      </nav>

      {view === "customers" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-blocker">
              <strong>Encrypted at rest; exact search only</strong>
              <p>
                Customer PII is decrypted only after customers.pii.read
                authorization and every search, view or export requires an
                access reason.
              </p>
            </div>
            <form
              className="live-inline-form live-search-form"
              onSubmit={customerSearch}
            >
              <input
                name="phone"
                placeholder="Exact phone"
                disabled={!canReadCustomer}
              />
              <input
                name="email"
                type="email"
                placeholder="Exact email"
                disabled={!canReadCustomer}
              />
              <input
                name="reason"
                placeholder="Access reason"
                required
                disabled={!canReadCustomer}
              />
              <button disabled={busy || !canReadCustomer}>Exact search</button>
            </form>
            <div className="live-card-list">
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  className={`live-record-card live-record-card--button ${selectedId === customer.id ? "is-selected" : ""}`}
                  onClick={() => void selectCustomer(customer)}
                >
                  <div>
                    <strong>
                      {customer.displayName ||
                        customer.email ||
                        customer.phone ||
                        "Restricted profile"}
                    </strong>
                    <span
                      className={`live-status live-status--${customer.status.toLowerCase()}`}
                    >
                      {customer.status} · r{customer.revision}
                    </span>
                  </div>
                  <p>
                    {customer.email || "No email"} ·{" "}
                    {customer.phone || "No phone"}
                  </p>
                </button>
              ))}
              {!customers.length ? (
                <p className="live-empty">
                  No customer records are listed without an exact protected
                  search.
                </p>
              ) : null}
            </div>
            {selected ? (
              <article className="live-record-card">
                <div>
                  <strong>Consent history</strong>
                  <span>{consents.length} immutable events</span>
                </div>
                {consents.length ? (
                  <ul>
                    {consents.map((consent) => (
                      <li key={consent.id}>
                        {consent.purpose} · {consent.channel} · {consent.status}{" "}
                        · {consent.wordingVersion} by {consent.actorDisplayName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="live-empty">No consent events retained.</p>
                )}
                {canExport ? (
                  <form className="live-inline-form" onSubmit={exportSelected}>
                    <input
                      name="reason"
                      aria-label="Customer export reason"
                      placeholder="Export reason"
                      required
                    />
                    <button disabled={busy}>Access export JSON</button>
                  </form>
                ) : null}
              </article>
            ) : null}
          </article>
          <aside className="inventory-admin-actions">
            {canCreateCustomer ? (
              <article className="live-panel">
                <p className="live-eyebrow">Fictional/test data only here</p>
                <h2>Create encrypted profile</h2>
                <form className="live-form" onSubmit={customerCreate}>
                  <input name="displayName" placeholder="Display name" />
                  <input name="phone" placeholder="Phone" />
                  <input name="email" type="email" placeholder="Email" />
                  <textarea name="notes" placeholder="Operational notes" />
                  <select name="preferredContactChannel">
                    <option value="">Preferred channel</option>
                    <option value="PHONE">Phone</option>
                    <option value="SMS">SMS</option>
                    <option value="EMAIL">Email</option>
                    <option value="WHATSAPP">WhatsApp</option>
                  </select>
                  <input name="reason" placeholder="Reason" required />
                  <button className="live-primary" disabled={busy}>
                    Create encrypted profile
                  </button>
                </form>
              </article>
            ) : null}
            {selected && canManageCustomer ? (
              <article className="live-panel">
                <p className="live-eyebrow">Marketing grants disabled</p>
                <h2>Append consent event</h2>
                <form className="live-form" onSubmit={consentRecord}>
                  <select name="purpose">
                    <option value="OPERATIONAL_CONTACT">
                      Operational contact
                    </option>
                    <option value="MARKETING" disabled>
                      Marketing (policy disabled)
                    </option>
                  </select>
                  <select name="channel">
                    <option value="EMAIL">Email</option>
                    <option value="PHONE">Phone</option>
                    <option value="SMS">SMS</option>
                    <option value="WHATSAPP">WhatsApp</option>
                  </select>
                  <select name="status">
                    <option value="GRANTED">Granted</option>
                    <option value="WITHDRAWN">Withdrawn</option>
                  </select>
                  <input name="source" placeholder="Source" required />
                  <input
                    name="wordingVersion"
                    placeholder="Wording version"
                    required
                  />
                  <label>
                    Occurred at
                    <input name="occurredAt" type="datetime-local" required />
                  </label>
                  <input name="reason" placeholder="Reason" required />
                  <button className="live-primary" disabled={busy}>
                    Append consent
                  </button>
                </form>
              </article>
            ) : null}
            {selected && canManageRequests ? (
              <article className="live-panel">
                <p className="live-eyebrow">Append-only case</p>
                <h2>Create privacy request</h2>
                <form className="live-form" onSubmit={privacyRequestCreate}>
                  <select name="requestType">
                    <option value="ACCESS">Access</option>
                    <option value="CORRECTION">Correction</option>
                    <option value="RESTRICTION">Restriction</option>
                    <option value="ANONYMIZATION">Anonymization</option>
                  </select>
                  <label>
                    Due at
                    <input name="dueAt" type="datetime-local" />
                  </label>
                  <input name="reason" placeholder="Reason" required />
                  <button className="live-primary" disabled={busy}>
                    Create request
                  </button>
                </form>
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}

      {view === "requests" ? (
        <article className="live-panel">
          <div className="live-panel__title">
            <div>
              <p className="live-eyebrow">Deterministic lifecycle</p>
              <h2>Privacy requests</h2>
            </div>
            <span>{requests.length} retained</span>
          </div>
          <div className="live-card-list">
            {requests.map((request) => (
              <article key={request.id} className="live-record-card">
                <div>
                  <strong>{request.requestType}</strong>
                  <span
                    className={`live-status live-status--${request.status.toLowerCase()}`}
                  >
                    {request.status} · r{request.revision}
                  </span>
                </div>
                <p>
                  Customer {request.customerId.slice(0, 8)}… · created by{" "}
                  {request.createdByDisplayName}
                </p>
                <ol>
                  {request.events.map((event) => (
                    <li key={event.id}>
                      {event.fromStatus || "START"} → {event.toStatus} by{" "}
                      {event.actorDisplayName}: {event.reason}
                    </li>
                  ))}
                </ol>
                {canManageRequests && nextStatuses(request).length ? (
                  <form
                    className="live-inline-form"
                    onSubmit={(event) => void requestTransition(event, request)}
                  >
                    <select name="status">
                      {nextStatuses(request).map((next) => (
                        <option key={next} value={next}>
                          {next}
                        </option>
                      ))}
                    </select>
                    <input
                      name="reason"
                      aria-label={`Transition reason ${request.id}`}
                      placeholder="Transition reason"
                      required
                    />
                    <button disabled={busy}>Apply transition</button>
                  </form>
                ) : null}
              </article>
            ))}
            {!requests.length ? (
              <p className="live-empty">No privacy requests retained.</p>
            ) : null}
          </div>
        </article>
      ) : null}

      {view === "retention" ? (
        <div className="inventory-admin-grid">
          <article className="live-panel">
            <div className="live-blocker">
              <strong>Retention execution and activation disabled</strong>
              <p>
                Drafts and non-destructive previews are available. Activation
                and deletion require an approved owner/legal policy and
                deployment flag.
              </p>
            </div>
            <div className="live-card-list">
              {policies.map((policy) => (
                <article key={policy.id} className="live-record-card">
                  <div>
                    <strong>
                      {policy.category} v{policy.version}
                    </strong>
                    <span
                      className={`live-status live-status--${policy.status.toLowerCase()}`}
                    >
                      {policy.status} · r{policy.revision}
                    </span>
                  </div>
                  <p>
                    {policy.durationDays} days · created by{" "}
                    {policy.createdByDisplayName}
                  </p>
                </article>
              ))}
              {!policies.length ? (
                <p className="live-empty">No retention drafts recorded.</p>
              ) : null}
            </div>
            {preview ? (
              <article className="live-record-card">
                <div>
                  <strong>Preview: {preview.category}</strong>
                  <span>{preview.candidateCount} candidates</span>
                </div>
                <p>
                  Cutoff {new Date(preview.cutoff).toLocaleString()} · execution
                  disabled
                </p>
                <p>
                  {preview.issues.length
                    ? preview.issues.join(", ")
                    : "No preview issues"}
                </p>
              </article>
            ) : null}
          </article>
          <aside className="inventory-admin-actions">
            {canManagePolicies ? (
              <article className="live-panel">
                <p className="live-eyebrow">Draft only</p>
                <h2>Create retention draft</h2>
                <form className="live-form" onSubmit={retentionCreate}>
                  <select name="category">
                    <option value="CUSTOMER_PROFILE">Customer profile</option>
                    <option value="ORDER_CONTACT">Order contact</option>
                    <option value="DELIVERY_DIRECTIONS">
                      Delivery directions
                    </option>
                  </select>
                  <input
                    name="version"
                    type="number"
                    min="1"
                    placeholder="Version"
                    required
                  />
                  <input
                    name="durationDays"
                    type="number"
                    min="1"
                    max="36500"
                    placeholder="Duration days"
                    required
                  />
                  <input name="reason" placeholder="Reason" required />
                  <button className="live-primary" disabled={busy}>
                    Create disabled draft
                  </button>
                </form>
              </article>
            ) : null}
            {canReadPolicies ? (
              <article className="live-panel">
                <p className="live-eyebrow">No deletion</p>
                <h2>Preview retention</h2>
                <form className="live-form" onSubmit={retentionPreview}>
                  <select name="policyId" required>
                    <option value="">Retention draft</option>
                    {policies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.category} v{policy.version}
                      </option>
                    ))}
                  </select>
                  <label>
                    As of
                    <input name="asOf" type="datetime-local" required />
                  </label>
                  <input name="reason" placeholder="Preview reason" required />
                  <button disabled={busy || !policies.length}>
                    Generate preview
                  </button>
                </form>
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
