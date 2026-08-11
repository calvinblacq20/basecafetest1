"use client";

import type {
  BranchHoursConfigurationResponse,
  BranchHoursPreviewResponse,
  DiningAreaResponse,
  StationResponse,
} from "@base-cafe/contracts";
import { ApiError } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  changeBranchScheduleStatus,
  changeDiningAreaStatus,
  changeDiningTableStatus,
  changeSpecialDayStatus,
  createBranchSchedule,
  createDiningArea,
  createDiningTable,
  createSpecialDay,
  createStation,
  getBranchHours,
  listDiningAreas,
  listStations,
  previewBranchHours,
  type AdminSession,
} from "./admin-client";
import { TaxConfiguration } from "./tax-configuration";
import { CatalogConfiguration } from "./catalog-configuration";

type Section = "stations" | "layout" | "hours" | "tax" | "catalog";
type Load<T> = {
  status: "loading" | "ready" | "denied" | "error";
  data: T;
  message?: string;
};

const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function status(value: string) {
  return (
    <span className={`live-status live-status--${value.toLowerCase()}`}>
      {value}
    </span>
  );
}

function localDate(value: string) {
  return value.slice(0, 10);
}

function minuteTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time ${value}; use HH:MM.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59)
    throw new Error(`Invalid time ${value}; use 00:00 through 23:59.`);
  return hour * 60 + minute;
}

function weeklyWindows(value: string) {
  return value.split(/\r?\n/).map((line, index) => {
    const [dayText, opensText, durationText] = line
      .split(",")
      .map((part) => part.trim());
    const isoWeekday = Number(dayText);
    const durationMinutes = Number(durationText);
    if (
      !dayText ||
      !opensText ||
      !durationText ||
      !Number.isInteger(isoWeekday) ||
      isoWeekday < 1 ||
      isoWeekday > 7 ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1_440
    ) {
      throw new Error(
        `Weekly line ${index + 1} must be weekday 1-7, HH:MM, duration 1-1440.`,
      );
    }
    return {
      isoWeekday,
      opensAtMinute: timeMinute(opensText),
      durationMinutes,
    };
  });
}

function specialWindows(value: string) {
  if (!value.trim()) return [];
  return value.split(/\r?\n/).map((line, index) => {
    const [opensText, durationText] = line
      .split(",")
      .map((part) => part.trim());
    const durationMinutes = Number(durationText);
    if (
      !opensText ||
      !durationText ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1_440
    ) {
      throw new Error(
        `Special-day line ${index + 1} must be HH:MM, duration 1-1440.`,
      );
    }
    return { opensAtMinute: timeMinute(opensText), durationMinutes };
  });
}

function reasonFor(action: string) {
  return window.prompt(`Reason for ${action} (required):`)?.trim() ?? "";
}

export function OperationalConfiguration({
  session,
  notify,
}: {
  session: AdminSession;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("stations");
  const [stations, setStations] = useState<Load<StationResponse[]>>({
    status: "loading",
    data: [],
  });
  const [areas, setAreas] = useState<Load<DiningAreaResponse[]>>({
    status: "loading",
    data: [],
  });
  const [hours, setHours] = useState<Load<BranchHoursConfigurationResponse>>({
    status: "loading",
    data: { schedules: [], specialHours: [] },
  });
  const [preview, setPreview] = useState<BranchHoursPreviewResponse | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const has = (permission: string) =>
    session.user.permissions.includes(permission);
  const load = useCallback(async () => {
    const run = async <T,>(
      set: (value: Load<T>) => void,
      task: () => Promise<T>,
      fallback: T,
    ) => {
      try {
        set({ status: "ready", data: await task() });
      } catch (error) {
        set({
          status:
            error instanceof ApiError && error.status === 403
              ? "denied"
              : "error",
          data: fallback,
          message: errorText(error),
        });
      }
    };
    await Promise.all([
      run(setStations, () => listStations(session), []),
      run(setAreas, () => listDiningAreas(session), []),
      run(setHours, () => getBranchHours(session), {
        schedules: [],
        specialHours: [],
      }),
    ]);
  }, [session]);

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

  async function stationCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createStation(session, {
          name: String(data.get("name")),
          externalKey: String(data.get("externalKey") || "") || undefined,
          kind: String(data.get("kind")) as "KITCHEN" | "BAR" | "OTHER",
          reason: String(data.get("reason")),
        }),
      "Station created and routed through the audit outbox.",
    );
    if (created) form.reset();
  }

  async function areaCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createDiningArea(session, {
          name: String(data.get("name")),
          externalKey: String(data.get("externalKey") || "") || undefined,
          displayOrder: Number(data.get("displayOrder")),
          reason: String(data.get("reason")),
        }),
      "Inactive dining area created.",
    );
    if (created) form.reset();
  }

  async function tableCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await perform(
      () =>
        createDiningTable(session, {
          diningAreaId: String(data.get("diningAreaId")),
          name: String(data.get("name")),
          externalKey: String(data.get("externalKey") || "") || undefined,
          capacity: Number(data.get("capacity")),
          displayOrder: Number(data.get("displayOrder")),
          combinableGroup:
            String(data.get("combinableGroup") || "") || undefined,
          reason: String(data.get("reason")),
        }),
      "Inactive dining table created.",
    );
    if (created) form.reset();
  }

  async function scheduleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const windows = weeklyWindows(String(data.get("windows")));
      const created = await perform(
        () =>
          createBranchSchedule(session, {
            effectiveFrom: String(data.get("effectiveFrom")),
            businessDayCutoffMinute: timeMinute(String(data.get("cutoff"))),
            windows,
            reason: String(data.get("reason")),
          }),
        "Draft schedule created; it is not active yet.",
      );
      if (created) form.reset();
    } catch (error) {
      notify(errorText(error));
    }
  }

  async function specialCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("kind")) as "CLOSED" | "CUSTOM_HOURS";
    try {
      const windows =
        kind === "CLOSED" ? [] : specialWindows(String(data.get("windows")));
      const created = await perform(
        () =>
          createSpecialDay(session, {
            localDate: String(data.get("localDate")),
            kind,
            label: String(data.get("label") || "") || undefined,
            windows,
            reason: String(data.get("reason")),
          }),
        "Draft special day created; it is not active yet.",
      );
      if (created) form.reset();
    } catch (error) {
      notify(errorText(error));
    }
  }

  async function previewResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      setPreview(
        await previewBranchHours(session, String(data.get("instant"))),
      );
    } catch (error) {
      notify(errorText(error));
    }
  }

  return (
    <div className="operational-configuration">
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Operational configuration</p>
          <h1>Branch setup</h1>
          <p>
            Live operational records and effective-dated draft tax profiles. No
            real branch facts are supplied by the interface.
          </p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </header>
      <div className="config-tabs" role="tablist">
        <button
          className={section === "stations" ? "is-active" : ""}
          onClick={() => setSection("stations")}
        >
          Stations
        </button>
        <button
          className={section === "layout" ? "is-active" : ""}
          onClick={() => setSection("layout")}
        >
          Dining layout
        </button>
        <button
          className={section === "hours" ? "is-active" : ""}
          onClick={() => setSection("hours")}
        >
          Hours & special days
        </button>
        <button
          className={section === "tax" ? "is-active" : ""}
          onClick={() => setSection("tax")}
        >
          Tax profiles
        </button>
        <button
          className={section === "catalog" ? "is-active" : ""}
          onClick={() => setSection("catalog")}
        >
          Catalog
        </button>
      </div>

      {section === "stations" ? (
        <section className="config-workspace">
          <article className="config-card">
            <header>
              <div>
                <p className="live-eyebrow">Preparation routing</p>
                <h2>Stations</h2>
              </div>
              <span>{stations.data.length} records</span>
            </header>
            {stations.status === "denied" ? (
              <p className="config-warning">
                Server denied <code>catalog.read</code>.
              </p>
            ) : null}
            <div className="config-records">
              {stations.data.map((station) => (
                <div className="config-record" key={station.id}>
                  <div>
                    <strong>{station.name}</strong>
                    <small>{station.externalKey ?? "No external key"}</small>
                  </div>
                  {status(station.kind)}
                  {status(station.isActive ? "ACTIVE" : "INACTIVE")}
                </div>
              ))}
              {stations.status === "ready" && !stations.data.length ? (
                <p className="live-empty">No stations configured.</p>
              ) : null}
            </div>
          </article>
          <aside className="config-card config-form-card">
            <p className="live-eyebrow">New station</p>
            <h2>Create routing target</h2>
            {has("catalog.write") ? (
              <form className="live-form" onSubmit={stationCreate}>
                <label>
                  Name
                  <input name="name" required />
                </label>
                <label>
                  External key
                  <input name="externalKey" />
                </label>
                <label>
                  Kind
                  <select name="kind">
                    <option>KITCHEN</option>
                    <option>BAR</option>
                    <option>OTHER</option>
                  </select>
                </label>
                <label>
                  Reason
                  <textarea name="reason" required />
                </label>
                <p className="config-note">
                  The current backend creates stations active. Station lifecycle
                  controls are not available yet.
                </p>
                <button className="live-primary" disabled={busy}>
                  Create station
                </button>
              </form>
            ) : (
              <p className="config-warning">
                Requires <code>catalog.write</code>.
              </p>
            )}
          </aside>
        </section>
      ) : null}

      {section === "layout" ? (
        <>
          <section className="config-workspace">
            <article className="config-card">
              <header>
                <div>
                  <p className="live-eyebrow">Dine-in map</p>
                  <h2>Areas & tables</h2>
                </div>
                <span>{areas.data.length} areas</span>
              </header>
              {areas.status === "denied" ? (
                <p className="config-warning">
                  Server denied <code>layout.read</code>.
                </p>
              ) : null}
              <div className="area-list">
                {areas.data.map((area) => (
                  <section key={area.id} className="area-record">
                    <header>
                      <div>
                        <strong>{area.name}</strong>
                        <small>
                          {area.tables.length} tables · revision {area.revision}
                        </small>
                      </div>
                      {status(area.isActive ? "ACTIVE" : "INACTIVE")}
                      {has("layout.manage") ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            const reason = reasonFor(
                              `${area.isActive ? "deactivate" : "activate"} ${area.name}`,
                            );
                            if (reason)
                              void perform(
                                () =>
                                  changeDiningAreaStatus(
                                    session,
                                    area,
                                    area.isActive ? "deactivate" : "activate",
                                    reason,
                                  ),
                                `Dining area ${area.isActive ? "deactivated" : "activated"}.`,
                              );
                          }}
                        >
                          {area.isActive ? "Deactivate" : "Activate"}
                        </button>
                      ) : null}
                    </header>
                    <div className="table-chips">
                      {area.tables.map((table) => (
                        <span key={table.id}>
                          <b>{table.name}</b>
                          <small>
                            {table.capacity} seats · r{table.revision}
                          </small>
                          {status(table.isActive ? "ACTIVE" : "INACTIVE")}
                          {has("layout.manage") ? (
                            <button
                              disabled={busy}
                              onClick={() => {
                                const reason = reasonFor(
                                  `${table.isActive ? "deactivate" : "activate"} ${table.name}`,
                                );
                                if (reason)
                                  void perform(
                                    () =>
                                      changeDiningTableStatus(
                                        session,
                                        table,
                                        table.isActive
                                          ? "deactivate"
                                          : "activate",
                                        reason,
                                      ),
                                    `Dining table ${table.isActive ? "deactivated" : "activated"}.`,
                                  );
                              }}
                            >
                              {table.isActive ? "Off" : "On"}
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </article>
            <aside className="config-stack">
              {has("layout.manage") ? (
                <>
                  <article className="config-card config-form-card">
                    <p className="live-eyebrow">New area</p>
                    <h2>Create inactive area</h2>
                    <form className="live-form" onSubmit={areaCreate}>
                      <label>
                        Name
                        <input name="name" required />
                      </label>
                      <label>
                        External key
                        <input name="externalKey" />
                      </label>
                      <label>
                        Display order
                        <input
                          name="displayOrder"
                          type="number"
                          min="0"
                          defaultValue="0"
                          required
                        />
                      </label>
                      <label>
                        Reason
                        <textarea name="reason" required />
                      </label>
                      <button className="live-primary" disabled={busy}>
                        Create area
                      </button>
                    </form>
                  </article>
                  <article className="config-card config-form-card">
                    <p className="live-eyebrow">New table</p>
                    <h2>Create inactive table</h2>
                    <form className="live-form" onSubmit={tableCreate}>
                      <label>
                        Dining area
                        <select name="diningAreaId" required>
                          <option value="">Choose area</option>
                          {areas.data.map((area) => (
                            <option value={area.id} key={area.id}>
                              {area.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Name
                        <input name="name" required />
                      </label>
                      <div className="config-form-row">
                        <label>
                          Capacity
                          <input
                            name="capacity"
                            type="number"
                            min="1"
                            defaultValue="2"
                            required
                          />
                        </label>
                        <label>
                          Display order
                          <input
                            name="displayOrder"
                            type="number"
                            min="0"
                            defaultValue="0"
                            required
                          />
                        </label>
                      </div>
                      <label>
                        External key
                        <input name="externalKey" />
                      </label>
                      <label>
                        Combinable group
                        <input name="combinableGroup" />
                      </label>
                      <label>
                        Reason
                        <textarea name="reason" required />
                      </label>
                      <button
                        className="live-primary"
                        disabled={busy || !areas.data.length}
                      >
                        Create table
                      </button>
                    </form>
                  </article>
                </>
              ) : (
                <p className="config-warning">
                  Requires <code>layout.manage</code>.
                </p>
              )}
            </aside>
          </section>
        </>
      ) : null}

      {section === "hours" ? (
        <>
          <div className="hours-summary">
            <strong>{hours.data.schedules.length} schedule versions</strong>
            <strong>
              {hours.data.specialHours.length} special-day versions
            </strong>
            <span>Missing configuration blocks business-date assignment.</span>
          </div>
          {hours.status === "denied" ? (
            <p className="config-warning">
              Server denied <code>branch-hours.read</code>.
            </p>
          ) : null}
          <section className="config-workspace">
            <div className="config-stack">
              <article className="config-card">
                <header>
                  <div>
                    <p className="live-eyebrow">Version history</p>
                    <h2>Weekly schedules</h2>
                  </div>
                </header>
                <div className="config-records">
                  {hours.data.schedules.map((schedule) => (
                    <div className="schedule-record" key={schedule.id}>
                      <div>
                        <strong>
                          Effective {localDate(schedule.effectiveFrom)}
                        </strong>
                        <small>
                          Cutoff {minuteTime(schedule.businessDayCutoffMinute)}{" "}
                          · revision {schedule.revision}
                        </small>
                      </div>
                      {status(schedule.status)}
                      <div className="window-list">
                        {schedule.windows.map((window) => (
                          <span key={window.id}>
                            {weekdays[window.isoWeekday - 1]}{" "}
                            {minuteTime(window.opensAtMinute)} ·{" "}
                            {window.durationMinutes} min
                          </span>
                        ))}
                      </div>
                      {has("branch-hours.manage") &&
                      schedule.status !== "CANCELLED" ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            const action =
                              schedule.status === "DRAFT"
                                ? "activate"
                                : "cancel";
                            const reason = reasonFor(
                              `${action} schedule effective ${localDate(schedule.effectiveFrom)}`,
                            );
                            if (reason)
                              void perform(
                                () =>
                                  changeBranchScheduleStatus(
                                    session,
                                    schedule,
                                    action,
                                    reason,
                                  ),
                                `Schedule ${action} command applied.`,
                              );
                          }}
                        >
                          {schedule.status === "DRAFT"
                            ? "Activate"
                            : "Cancel if future"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
              <article className="config-card">
                <header>
                  <div>
                    <p className="live-eyebrow">Date overrides</p>
                    <h2>Special days</h2>
                  </div>
                </header>
                <div className="config-records">
                  {hours.data.specialHours.map((special) => (
                    <div className="schedule-record" key={special.id}>
                      <div>
                        <strong>
                          {localDate(special.localDate)} · {special.kind}
                        </strong>
                        <small>
                          {special.label ?? "No label"} · revision{" "}
                          {special.revision}
                        </small>
                      </div>
                      {status(special.status)}
                      <div className="window-list">
                        {special.windows.map((window) => (
                          <span key={window.id}>
                            {minuteTime(window.opensAtMinute)} ·{" "}
                            {window.durationMinutes} min
                          </span>
                        ))}
                      </div>
                      {has("branch-hours.manage") &&
                      (special.status === "DRAFT" ||
                        special.status === "ACTIVE") ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            const action =
                              special.status === "DRAFT"
                                ? "activate"
                                : "cancel";
                            const reason = reasonFor(
                              `${action} special day ${localDate(special.localDate)}`,
                            );
                            if (reason)
                              void perform(
                                () =>
                                  changeSpecialDayStatus(
                                    session,
                                    special,
                                    action,
                                    reason,
                                  ),
                                `Special-day ${action} command applied.`,
                              );
                          }}
                        >
                          {special.status === "DRAFT" ? "Activate" : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            </div>
            <aside className="config-stack">
              {has("branch-hours.manage") ? (
                <>
                  <article className="config-card config-form-card">
                    <p className="live-eyebrow">New version</p>
                    <h2>Create draft schedule</h2>
                    <form className="live-form" onSubmit={scheduleCreate}>
                      <label>
                        Effective local date
                        <input name="effectiveFrom" type="date" required />
                      </label>
                      <label>
                        Business-day cutoff
                        <input name="cutoff" type="time" required />
                      </label>
                      <label>
                        Weekly windows
                        <textarea
                          name="windows"
                          required
                          placeholder={"1,09:00,600\n1,18:00,300\n2,09:00,600"}
                        />
                      </label>
                      <p className="config-note">
                        One line per window: ISO weekday 1–7, opening HH:MM,
                        duration minutes. Adjacent windows are allowed; overlaps
                        are rejected.
                      </p>
                      <label>
                        Reason
                        <textarea name="reason" required />
                      </label>
                      <button className="live-primary" disabled={busy}>
                        Create draft only
                      </button>
                    </form>
                  </article>
                  <article className="config-card config-form-card">
                    <p className="live-eyebrow">New override</p>
                    <h2>Create draft special day</h2>
                    <form className="live-form" onSubmit={specialCreate}>
                      <label>
                        Local date
                        <input name="localDate" type="date" required />
                      </label>
                      <label>
                        Kind
                        <select name="kind">
                          <option>CLOSED</option>
                          <option>CUSTOM_HOURS</option>
                        </select>
                      </label>
                      <label>
                        Label
                        <input name="label" />
                      </label>
                      <label>
                        Custom windows
                        <textarea
                          name="windows"
                          placeholder={"09:00,360\n18:00,240"}
                        />
                      </label>
                      <p className="config-note">
                        Leave windows empty for CLOSED. Custom lines use opening
                        HH:MM, duration minutes.
                      </p>
                      <label>
                        Reason
                        <textarea name="reason" required />
                      </label>
                      <button className="live-primary" disabled={busy}>
                        Create draft only
                      </button>
                    </form>
                  </article>
                </>
              ) : null}
              <article className="config-card config-form-card">
                <p className="live-eyebrow">Deterministic resolver</p>
                <h2>UTC preview</h2>
                <form className="live-form" onSubmit={previewResolve}>
                  <label>
                    UTC instant
                    <input
                      name="instant"
                      type="text"
                      inputMode="text"
                      placeholder="2026-08-09T12:00:00.000Z"
                      required
                    />
                  </label>
                  <p className="field-note">
                    Enter an ISO 8601 instant with an explicit Z or UTC offset.
                  </p>
                  <button disabled={busy}>Resolve authoritative state</button>
                </form>
                {preview ? (
                  <dl className="preview-results">
                    <div>
                      <dt>Timezone</dt>
                      <dd>{preview.timezone}</dd>
                    </div>
                    <div>
                      <dt>Local</dt>
                      <dd>
                        {preview.local.localDate} {preview.local.localTime}
                      </dd>
                    </div>
                    <div>
                      <dt>Business date</dt>
                      <dd>{preview.businessDate ?? "Blocked"}</dd>
                    </div>
                    <div>
                      <dt>Open state</dt>
                      <dd>{preview.isOpen ? "OPEN" : "CLOSED"}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{preview.currentSource}</dd>
                    </div>
                    <div>
                      <dt>Issues</dt>
                      <dd>
                        {preview.issues.map((issue) => issue.code).join(", ") ||
                          "None"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </article>
            </aside>
          </section>
        </>
      ) : null}
      {section === "tax" ? (
        <TaxConfiguration session={session} notify={notify} />
      ) : null}
      {section === "catalog" ? (
        <CatalogConfiguration session={session} notify={notify} />
      ) : null}
    </div>
  );
}
