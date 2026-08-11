"use client";

import {
  ghanaVatReference2026,
  type TaxProfileResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  activateTaxProfile,
  confirmTaxProfile,
  createTaxProfile,
  listTaxProfiles,
  updateTaxProfile,
  type AdminSession,
} from "./admin-client";

type Editor = {
  profileId: string | null;
  key: string;
  name: string;
  priceMode: "" | "INCLUSIVE" | "EXCLUSIVE";
  roundingMode: "" | "HALF_UP" | "HALF_EVEN" | "DOWN";
  roundingScope: "" | "LINE" | "INVOICE";
  effectiveFrom: string;
  effectiveTo: string;
  components: string;
  reason: string;
};

const emptyEditor: Editor = {
  profileId: null,
  key: "",
  name: "",
  priceMode: "",
  roundingMode: "",
  roundingScope: "",
  effectiveFrom: "",
  effectiveTo: "",
  components: "",
  reason: "",
};

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "The request failed.";
}

function ppmFromPercent(value: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new Error("Rates use percentages with at most 4 decimals.");
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(4, "0"));
  const ppm = whole * 10_000 + fraction;
  if (ppm > 1_000_000) throw new Error("A component rate cannot exceed 100%.");
  return ppm;
}

function percentFromPpm(ratePpm: number) {
  const whole = Math.floor(ratePpm / 10_000);
  const fraction = String(ratePpm % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function parseComponents(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0)
    throw new Error("At least one tax component is required.");
  return lines.map((line, calculationOrder) => {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 3 || !cells[0] || !cells[1] || !cells[2]) {
      throw new Error(`Invalid component line: ${line}`);
    }
    return {
      code: cells[0],
      receiptLabel: cells[1],
      ratePpm: ppmFromPercent(cells[2]),
      calculationOrder,
    };
  });
}

function componentLines(profile: TaxProfileResponse) {
  return profile.components
    .map(
      (component) =>
        `${component.code},${component.receiptLabel},${percentFromPpm(component.ratePpm)}`,
    )
    .join("\n");
}

export function TaxConfiguration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [profiles, setProfiles] = useState<TaxProfileResponse[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">(
    "loading",
  );
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [presetVisible, setPresetVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const has = (permission: string) =>
    session.user.permissions.includes(permission);

  const load = useCallback(async () => {
    try {
      setProfiles(await listTaxProfiles(session));
      setState("ready");
    } catch (error) {
      setState(
        error instanceof ApiError && error.status === 403 ? "denied" : "error",
      );
      notify(errorText(error));
    }
  }, [notify, session]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  function useReferencePreset() {
    setPresetVisible(true);
    setEditor((current) => ({
      ...current,
      components: ghanaVatReference2026.components
        .map(
          (component) =>
            `${component.code},${component.receiptLabel},${component.ratePercent}`,
        )
        .join("\n"),
    }));
  }

  function edit(profile: TaxProfileResponse) {
    setPresetVisible(false);
    setEditor({
      profileId: profile.id,
      key: profile.key,
      name: profile.name,
      priceMode: profile.priceMode,
      roundingMode: profile.roundingMode,
      roundingScope: profile.roundingScope,
      effectiveFrom: profile.effectiveFrom,
      effectiveTo: profile.effectiveTo ?? "",
      components: componentLines(profile),
      reason: "",
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor.priceMode || !editor.roundingMode || !editor.roundingScope) {
      return notify("Price mode and both rounding choices are required.");
    }
    setBusy(true);
    try {
      const components = parseComponents(editor.components);
      const existing = editor.profileId
        ? profiles.find((profile) => profile.id === editor.profileId)
        : undefined;
      if (editor.profileId && !existing) {
        throw new Error("The selected draft is no longer available. Refresh.");
      }
      const shared = {
        name: editor.name,
        priceMode: editor.priceMode,
        roundingMode: editor.roundingMode,
        roundingScope: editor.roundingScope,
        effectiveFrom: editor.effectiveFrom,
        components,
        reason: editor.reason,
      };
      if (existing) {
        await updateTaxProfile(session, existing, {
          ...shared,
          effectiveTo: editor.effectiveTo || null,
        });
        notify("Draft tax profile revision updated.");
      } else {
        await createTaxProfile(session, {
          key: editor.key,
          ...shared,
          effectiveTo: editor.effectiveTo || undefined,
        });
        notify("Draft tax profile created. It is not confirmed or active.");
      }
      setEditor(emptyEditor);
      setPresetVisible(false);
      await load();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(profile: TaxProfileResponse) {
    const approvalReference = window
      .prompt("Genuine owner/accountant/GRA approval reference (required):")
      ?.trim();
    if (!approvalReference) return;
    const reason = window
      .prompt("Reason for recording approval (required):")
      ?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await confirmTaxProfile(session, profile, approvalReference, reason);
      notify("Approval evidence recorded; rates are now immutable.");
      await load();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function activate(profile: TaxProfileResponse) {
    const reason = window
      .prompt("Reason for tax activation (required):")
      ?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await activateTaxProfile(session, profile, reason);
      notify("Confirmed tax profile activated.");
      await load();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="config-workspace tax-workspace">
      <article className="config-card">
        <header>
          <div>
            <p className="live-eyebrow">Effective-dated history</p>
            <h2>Tax profiles</h2>
          </div>
          <button onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </header>
        {state === "denied" ? (
          <p className="config-warning">
            Server denied <code>tax.read</code>.
          </p>
        ) : null}
        {state === "error" ? (
          <p className="config-warning">Tax profiles could not be loaded.</p>
        ) : null}
        {state === "loading" ? <p className="live-empty">Loading…</p> : null}
        <div className="config-records tax-records">
          {profiles.map((profile) => (
            <section className="tax-record" key={profile.id}>
              <header>
                <div>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.key} · revision {profile.revision}
                  </small>
                </div>
                <span
                  className={`live-status live-status--${profile.status.toLowerCase()}`}
                >
                  {profile.status}
                </span>
              </header>
              <p>
                {profile.priceMode} · {profile.roundingMode} /{" "}
                {profile.roundingScope}
              </p>
              <p>
                {new Date(profile.effectiveFrom).toISOString()} →{" "}
                {profile.effectiveTo
                  ? new Date(profile.effectiveTo).toISOString()
                  : "open-ended"}
              </p>
              <div className="tax-components">
                {profile.components.map((component) => (
                  <span key={component.id}>
                    {component.receiptLabel} {percentFromPpm(component.ratePpm)}
                    %
                  </span>
                ))}
              </div>
              <footer>
                {profile.status === "DRAFT" && has("tax.configure") ? (
                  <button onClick={() => edit(profile)} disabled={busy}>
                    Edit draft
                  </button>
                ) : null}
                {profile.status === "DRAFT" && has("tax.approve") ? (
                  <button onClick={() => void confirm(profile)} disabled={busy}>
                    Record genuine approval
                  </button>
                ) : null}
                {profile.status === "CONFIRMED" && has("tax.configure") ? (
                  <button
                    onClick={() => void activate(profile)}
                    disabled={busy}
                  >
                    Activate
                  </button>
                ) : null}
              </footer>
            </section>
          ))}
          {state === "ready" && profiles.length === 0 ? (
            <p className="live-empty">No tax profile has been configured.</p>
          ) : null}
        </div>
      </article>

      <aside className="config-stack">
        <article className="config-card config-form-card">
          <p className="live-eyebrow">
            {editor.profileId ? "Revision-aware editor" : "New version"}
          </p>
          <h2>{editor.profileId ? "Update draft" : "Create draft only"}</h2>
          {!has("tax.configure") ? (
            <p className="config-warning">
              Server permission <code>tax.configure</code> is required.
            </p>
          ) : (
            <form className="live-form" onSubmit={submit}>
              <div className="split-fields">
                <label>
                  Key
                  <input
                    value={editor.key}
                    disabled={Boolean(editor.profileId)}
                    onChange={(event) =>
                      setEditor({ ...editor, key: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Name
                  <input
                    value={editor.name}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                    required
                  />
                </label>
              </div>
              <label>
                Price mode — owner/accountant input
                <select
                  value={editor.priceMode}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      priceMode: event.target.value as Editor["priceMode"],
                    })
                  }
                  required
                >
                  <option value="">Choose explicitly</option>
                  <option value="INCLUSIVE">INCLUSIVE</option>
                  <option value="EXCLUSIVE">EXCLUSIVE</option>
                </select>
              </label>
              <div className="split-fields">
                <label>
                  Rounding mode
                  <select
                    value={editor.roundingMode}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        roundingMode: event.target
                          .value as Editor["roundingMode"],
                      })
                    }
                    required
                  >
                    <option value="">Choose explicitly</option>
                    <option value="HALF_UP">HALF_UP</option>
                    <option value="HALF_EVEN">HALF_EVEN</option>
                    <option value="DOWN">DOWN</option>
                  </select>
                </label>
                <label>
                  Rounding scope
                  <select
                    value={editor.roundingScope}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        roundingScope: event.target
                          .value as Editor["roundingScope"],
                      })
                    }
                    required
                  >
                    <option value="">Choose explicitly</option>
                    <option value="LINE">LINE</option>
                    <option value="INVOICE">INVOICE</option>
                  </select>
                </label>
              </div>
              <label>
                Effective from (explicit ISO instant)
                <input
                  value={editor.effectiveFrom}
                  onChange={(event) =>
                    setEditor({ ...editor, effectiveFrom: event.target.value })
                  }
                  placeholder="2026-01-01T00:00:00.000Z"
                  required
                />
              </label>
              <label>
                Effective to (optional ISO instant)
                <input
                  value={editor.effectiveTo}
                  onChange={(event) =>
                    setEditor({ ...editor, effectiveTo: event.target.value })
                  }
                  placeholder="Open-ended"
                />
              </label>
              <label>
                Components
                <textarea
                  value={editor.components}
                  onChange={(event) =>
                    setEditor({ ...editor, components: event.target.value })
                  }
                  placeholder={"VAT,VAT,15\nNHIL,NHIL,2.5"}
                  required
                />
              </label>
              <p className="field-note">
                One line per component: code, receipt label, percentage. Rates
                become integer parts-per-million; no floating-point tax values
                are stored.
              </p>
              <label>
                Reason
                <textarea
                  value={editor.reason}
                  onChange={(event) =>
                    setEditor({ ...editor, reason: event.target.value })
                  }
                  required
                />
              </label>
              <div className="form-actions">
                <button className="live-primary" disabled={busy}>
                  {editor.profileId
                    ? "Save new revision"
                    : "Create inactive draft"}
                </button>
                {editor.profileId ? (
                  <button
                    type="button"
                    onClick={() => setEditor(emptyEditor)}
                    disabled={busy}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </article>

        <article className="config-card gra-reference">
          <p className="live-eyebrow">Reference data, not configuration</p>
          <h2>{ghanaVatReference2026.label}</h2>
          <p>
            Effective-date reference: {ghanaVatReference2026.effectiveFrom}. GRA
            states VAT 15%, NHIL 2.5%, and GETFund 2.5% use the same base; the
            COVID-19 levy is absent.
          </p>
          <button type="button" onClick={useReferencePreset} disabled={busy}>
            Fill component rates only
          </button>
          <a
            href={ghanaVatReference2026.source.url}
            target="_blank"
            rel="noreferrer"
          >
            Official GRA source ↗
          </a>
          {presetVisible ? (
            <p className="config-warning">
              Reference loaded. It did not choose price mode, rounding,
              effective instant, registration status, or approval—and it cannot
              confirm or activate this draft.
            </p>
          ) : null}
        </article>
      </aside>
    </section>
  );
}
