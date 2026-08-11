"use client";

import type {
  DeviceResponse,
  PermissionResponse,
  RoleResponse,
  StaffResponse,
} from "@base-cafe/contracts";
import { Brand } from "@base-cafe/ui";
import { ApiError } from "@base-cafe/web-client";
import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  assignStaffRole,
  changeDeviceStatus,
  changeStaffStatus,
  createDevice,
  createRole,
  createStaff,
  listDevices,
  listPermissions,
  listRoles,
  listStaff,
  loadAdminSession,
  loginAdmin,
  logoutAdmin,
  removeStaffRole,
  type AdminSession,
} from "./admin-client";
import { ManagementReports } from "./management-reports";
import { InventoryAdministration } from "./inventory-administration";
import { OperationalConfiguration } from "./operational-configuration";
import { ProcurementAdministration } from "./procurement-administration";
import { PrivacyAdministration } from "./privacy-administration";
import { MfaAdministration } from "./mfa-administration";

type View =
  | "staff"
  | "devices"
  | "configuration"
  | "reports"
  | "inventory"
  | "procurement"
  | "privacy"
  | "mfa";
type LoadState<T> = {
  data: T;
  status: "idle" | "loading" | "ready" | "denied" | "error";
  message?: string;
};

const empty = <T,>(): LoadState<T[]> => ({ data: [], status: "idle" });

function messageFor(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function activeRoles(staff: StaffResponse) {
  return staff.assignments.filter((assignment) => !assignment.revokedAt);
}

function Status({ value }: { value: string }) {
  return (
    <span className={`live-status live-status--${value.toLowerCase()}`}>
      {value}
    </span>
  );
}

function Blocker({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="live-blocker">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function Modal({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div
      className="live-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-modal-title"
      >
        <header>
          <div>
            <p className="live-eyebrow">Audited mutation</p>
            <h2 id="live-modal-title">{title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <p>{description}</p>
        {children}
      </section>
    </div>
  );
}

function Login({ signedIn }: { signedIn: (session: AdminSession) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const fingerprint = String(data.get("fingerprint") ?? "").trim();
    const secondFactor = String(data.get("secondFactor") ?? "").trim();
    try {
      signedIn(
        await loginAdmin({
          deviceId: String(data.get("deviceId") ?? "").trim(),
          email: String(data.get("email") ?? "").trim(),
          password: String(data.get("password") ?? ""),
          ...(fingerprint ? { deviceFingerprintHash: fingerprint } : {}),
          ...(secondFactor
            ? /^\d{6}$/.test(secondFactor)
              ? { mfaCode: secondFactor }
              : { mfaRecoveryCode: secondFactor.toUpperCase() }
            : {}),
        }),
      );
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="admin-login">
      <section className="admin-login__card">
        <Brand />
        <p className="live-eyebrow">Protected administration</p>
        <h1>Sign in to manage this branch</h1>
        <p className="admin-login__intro">
          Use an enrolled device and a staff account with the required
          server-side permissions.
        </p>
        <form onSubmit={submit}>
          <label>
            Device ID
            <input
              name="deviceId"
              required
              autoComplete="off"
              placeholder="UUID"
            />
          </label>
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={12}
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            Device fingerprint hash <span>(if bound)</span>
            <input
              name="fingerprint"
              pattern="[a-fA-F0-9]{64}"
              autoComplete="off"
              placeholder="64 hexadecimal characters"
            />
          </label>
          <label>
            Authenticator or recovery code <span>(if enabled)</span>
            <input name="secondFactor" autoComplete="one-time-code" />
          </label>
          {error ? (
            <p className="live-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="live-primary" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="admin-login__demo">
          Need a fictional preview?{" "}
          <Link href="/?demo=1">Open explicit demo mode</Link>.
        </p>
      </section>
    </main>
  );
}

export function AdministrationShell() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("staff");
  const [staff, setStaff] = useState<LoadState<StaffResponse[]>>(empty);
  const [roles, setRoles] = useState<LoadState<RoleResponse[]>>(empty);
  const [permissions, setPermissions] =
    useState<LoadState<PermissionResponse[]>>(empty);
  const [devices, setDevices] = useState<LoadState<DeviceResponse[]>>(empty);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "staff" | "role" | "device" | "staff-action" | "device-action" | null
  >(null);
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async (active: AdminSession) => {
    const run = async <T,>(
      set: (state: LoadState<T[]>) => void,
      task: () => Promise<T[]>,
    ) => {
      set({ data: [], status: "loading" });
      try {
        set({ data: await task(), status: "ready" });
      } catch (error) {
        set({
          data: [],
          status:
            error instanceof ApiError && error.status === 403
              ? "denied"
              : "error",
          message: messageFor(error),
        });
      }
    };
    await Promise.all([
      run(setStaff, () => listStaff(active)),
      run(setRoles, () => listRoles(active)),
      run(setPermissions, () => listPermissions(active)),
      run(setDevices, () => listDevices(active)),
    ]);
  }, []);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      const saved = loadAdminSession();
      setSession(saved);
      setReady(true);
      if (saved) void loadAll(saved);
    });
    const unauthorized = () => {
      setSession(null);
      setNotice("Your session ended. Sign in again.");
    };
    window.addEventListener("base-cafe:admin-unauthorized", unauthorized);
    return () => {
      mounted = false;
      window.removeEventListener("base-cafe:admin-unauthorized", unauthorized);
    };
  }, [loadAll]);

  const selectedStaff =
    staff.data.find((entry) => entry.id === staffId) ?? null;
  const selectedDevice =
    devices.data.find((entry) => entry.id === deviceId) ?? null;
  const has = (permission: string) =>
    session?.user.permissions.includes(permission) ?? false;
  const refresh = async (note: string) => {
    if (session) await loadAll(session);
    setNotice(note);
  };

  async function roleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    try {
      await createRole(session, {
        name: String(data.get("name")),
        scope: String(data.get("scope")) as "BRANCH" | "ORGANIZATION",
        permissionKeys: data.getAll("permission").map(String),
        reason: String(data.get("reason")),
      });
      setModal(null);
      await refresh("Role created with an audit entry.");
    } catch (error) {
      setNotice(messageFor(error));
    }
  }

  async function staffCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    try {
      const created = await createStaff(session, {
        displayName: String(data.get("displayName")),
        email: String(data.get("email")),
        initialPassword: String(data.get("initialPassword")),
        roleIds: data.getAll("roleId").map(String),
        reason: String(data.get("reason")),
      });
      setStaffId(created.id);
      setModal(null);
      await refresh("Staff created. The temporary password was not retained.");
    } catch (error) {
      setNotice(messageFor(error));
    }
  }

  async function deviceCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    try {
      const created = await createDevice(session, String(data.get("name")));
      setDeviceId(created.id);
      setModal(null);
      await refresh("Pending device registered.");
    } catch (error) {
      setNotice(messageFor(error));
    }
  }

  async function staffAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedStaff) return;
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action"));
    const reason = String(data.get("reason"));
    try {
      if (action === "assign")
        await assignStaffRole(
          session,
          selectedStaff,
          String(data.get("roleId")),
          reason,
        );
      else if (action.startsWith("remove:"))
        await removeStaffRole(session, selectedStaff, action.slice(7), reason);
      else
        await changeStaffStatus(
          session,
          selectedStaff,
          action as "disable" | "reactivate",
          reason,
        );
      setModal(null);
      await refresh("Staff change recorded with immutable role history.");
    } catch (error) {
      setNotice(messageFor(error));
    }
  }

  async function deviceAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedDevice) return;
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action")) as "activate" | "revoke";
    try {
      await changeDeviceStatus(session, selectedDevice, action, {
        reason: String(data.get("reason")),
        fingerprintHash: String(data.get("fingerprintHash") ?? "") || undefined,
      });
      setModal(null);
      await refresh(
        action === "activate"
          ? "Device activated and fingerprint bound."
          : "Device revoked and its sessions terminated.",
      );
    } catch (error) {
      setNotice(messageFor(error));
    }
  }

  if (!ready)
    return (
      <main className="admin-login">Loading protected administration…</main>
    );
  if (!session)
    return (
      <Login
        signedIn={(active) => {
          setSession(active);
          void loadAll(active);
        }}
      />
    );

  return (
    <div className="live-admin">
      <header className="live-topbar">
        <Brand />
        <span className="live-scope">
          Branch {shortId(session.scope.branchId)}
        </span>
        <span className="live-connection">
          <i />
          Authenticated live API
        </span>
        <div className="live-topbar__user">
          <span>
            <strong>{session.user.displayName}</strong>
            <small>{session.user.email}</small>
          </span>
          <button
            onClick={() =>
              void logoutAdmin(session).then(() => setSession(null))
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <aside className="live-nav">
        <nav>
          <button
            className={view === "staff" ? "is-active" : ""}
            onClick={() => setView("staff")}
          >
            Staff & roles
          </button>
          <button
            className={view === "devices" ? "is-active" : ""}
            onClick={() => setView("devices")}
          >
            Devices
          </button>
          <button
            className={view === "configuration" ? "is-active" : ""}
            onClick={() => setView("configuration")}
          >
            Configuration
          </button>
          <button
            className={view === "reports" ? "is-active" : ""}
            onClick={() => setView("reports")}
          >
            Reports
          </button>
          <button
            className={view === "inventory" ? "is-active" : ""}
            onClick={() => setView("inventory")}
          >
            Inventory
          </button>
          <button
            className={view === "procurement" ? "is-active" : ""}
            onClick={() => setView("procurement")}
          >
            Procurement
          </button>
          <button
            className={view === "privacy" ? "is-active" : ""}
            onClick={() => setView("privacy")}
          >
            Privacy
          </button>
          <button
            className={view === "mfa" ? "is-active" : ""}
            onClick={() => setView("mfa")}
          >
            My MFA
          </button>
          <Link href="/security">Security</Link>
          <Link href="/readiness">Pilot readiness</Link>
        </nav>
        <Link className="live-demo-link" href="/?demo=1">
          Fictional demo
        </Link>
      </aside>
      <main className="live-content">
        {view === "staff" ? (
          <>
            <header className="live-heading">
              <div>
                <p className="live-eyebrow">Identity and authorization</p>
                <h1>Staff & roles</h1>
                <p>
                  Manage attributed accounts and least-privilege role
                  assignments.
                </p>
              </div>
              <div className="live-heading__actions">
                {has("roles.manage") ? (
                  <button onClick={() => setModal("role")}>New role</button>
                ) : null}
                {has("staff.manage") ? (
                  <button
                    className="live-primary"
                    onClick={() => setModal("staff")}
                  >
                    New staff member
                  </button>
                ) : null}
              </div>
            </header>
            {staff.status === "denied" ? (
              <Blocker title="Staff permission required">
                The server withheld staff because this session lacks{" "}
                <code>staff.manage</code>.
              </Blocker>
            ) : null}
            {roles.status === "denied" ? (
              <Blocker title="Role permission required">
                The server withheld roles because this session lacks{" "}
                <code>roles.manage</code>.
              </Blocker>
            ) : null}
            {staff.status === "error" ? (
              <Blocker title="Staff could not be loaded">
                {staff.message}
              </Blocker>
            ) : null}
            <section className="live-grid">
              <article className="live-list-card">
                <header>
                  <strong>Staff accounts</strong>
                  <span>
                    {staff.status === "loading"
                      ? "Loading…"
                      : `${staff.data.length} records`}
                  </span>
                </header>
                <div className="live-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff member</th>
                        <th>Status</th>
                        <th>Active roles</th>
                        <th>Rev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.data.map((entry) => (
                        <tr
                          key={entry.id}
                          className={entry.id === staffId ? "is-selected" : ""}
                          onClick={() => setStaffId(entry.id)}
                        >
                          <td>
                            <strong>{entry.displayName}</strong>
                            <small>{entry.email}</small>
                          </td>
                          <td>
                            <Status value={entry.status} />
                          </td>
                          <td>
                            {activeRoles(entry)
                              .map((role) => role.role.name)
                              .join(", ") || "None"}
                          </td>
                          <td>{entry.revision}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {staff.status === "ready" && !staff.data.length ? (
                  <p className="live-empty">No visible staff accounts.</p>
                ) : null}
              </article>
              <aside className="live-inspector">
                {selectedStaff ? (
                  <>
                    <p className="live-eyebrow">Staff record</p>
                    <h2>{selectedStaff.displayName}</h2>
                    <p>{selectedStaff.email}</p>
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <Status value={selectedStaff.status} />
                        </dd>
                      </div>
                      <div>
                        <dt>Password replacement</dt>
                        <dd>
                          {selectedStaff.mustChangePassword
                            ? "Required"
                            : "Not required"}
                        </dd>
                      </div>
                      <div>
                        <dt>Revision</dt>
                        <dd>{selectedStaff.revision}</dd>
                      </div>
                    </dl>
                    <div className="live-role-list">
                      {activeRoles(selectedStaff).map((assignment) => (
                        <span key={assignment.id}>
                          {assignment.role.name}
                          <small>{assignment.role.scope}</small>
                        </span>
                      ))}
                    </div>
                    {has("staff.manage") ? (
                      <button
                        className="live-primary"
                        onClick={() => setModal("staff-action")}
                      >
                        Manage account
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="live-empty">
                    Select a staff account to inspect its access.
                  </p>
                )}
              </aside>
            </section>
          </>
        ) : view === "devices" ? (
          <>
            <header className="live-heading">
              <div>
                <p className="live-eyebrow">Trusted endpoints</p>
                <h1>Devices</h1>
                <p>
                  Register, bind, and revoke devices without exposing
                  fingerprint hashes.
                </p>
              </div>
              {has("device.manage") ? (
                <button
                  className="live-primary"
                  onClick={() => setModal("device")}
                >
                  Register device
                </button>
              ) : null}
            </header>
            {devices.status === "denied" ? (
              <Blocker title="Device permission required">
                The server withheld devices because this session lacks{" "}
                <code>device.manage</code>.
              </Blocker>
            ) : null}
            {devices.status === "error" ? (
              <Blocker title="Devices could not be loaded">
                {devices.message}
              </Blocker>
            ) : null}
            <section className="live-grid">
              <article className="live-list-card">
                <header>
                  <strong>Branch devices</strong>
                  <span>
                    {devices.status === "loading"
                      ? "Loading…"
                      : `${devices.data.length} records`}
                  </span>
                </header>
                <div className="live-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Status</th>
                        <th>Fingerprint</th>
                        <th>Rev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.data.map((entry) => (
                        <tr
                          key={entry.id}
                          className={entry.id === deviceId ? "is-selected" : ""}
                          onClick={() => setDeviceId(entry.id)}
                        >
                          <td>
                            <strong>{entry.name}</strong>
                            <small>{shortId(entry.id)}</small>
                          </td>
                          <td>
                            <Status value={entry.status} />
                          </td>
                          <td>
                            {entry.fingerprintBound ? "Bound" : "Not bound"}
                          </td>
                          <td>{entry.revision}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
              <aside className="live-inspector">
                {selectedDevice ? (
                  <>
                    <p className="live-eyebrow">Device record</p>
                    <h2>{selectedDevice.name}</h2>
                    <p>{selectedDevice.id}</p>
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <Status value={selectedDevice.status} />
                        </dd>
                      </div>
                      <div>
                        <dt>Fingerprint</dt>
                        <dd>
                          {selectedDevice.fingerprintBound
                            ? "Bound (hash hidden)"
                            : "Not bound"}
                        </dd>
                      </div>
                      <div>
                        <dt>Enrolled</dt>
                        <dd>
                          {selectedDevice.enrolledAt
                            ? new Date(
                                selectedDevice.enrolledAt,
                              ).toLocaleString()
                            : "Not enrolled"}
                        </dd>
                      </div>
                      <div>
                        <dt>Revision</dt>
                        <dd>{selectedDevice.revision}</dd>
                      </div>
                    </dl>
                    {has("device.manage") &&
                    selectedDevice.status !== "REVOKED" ? (
                      <button
                        className="live-primary"
                        onClick={() => setModal("device-action")}
                      >
                        {selectedDevice.status === "PENDING"
                          ? "Activate device"
                          : "Revoke device"}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="live-empty">
                    Select a device to inspect its trust state.
                  </p>
                )}
              </aside>
            </section>
          </>
        ) : view === "configuration" ? (
          <OperationalConfiguration session={session} notify={setNotice} />
        ) : view === "reports" ? (
          <ManagementReports session={session} notify={setNotice} />
        ) : view === "inventory" ? (
          <InventoryAdministration session={session} notify={setNotice} />
        ) : view === "procurement" ? (
          <ProcurementAdministration session={session} notify={setNotice} />
        ) : view === "privacy" ? (
          <PrivacyAdministration session={session} notify={setNotice} />
        ) : (
          <MfaAdministration session={session} />
        )}
      </main>
      {notice ? (
        <button className="live-toast" onClick={() => setNotice("")}>
          <span>{notice}</span>
          <b>×</b>
        </button>
      ) : null}
      {modal === "role" ? (
        <Modal
          title="Create role"
          description="The server rejects permission escalation beyond your effective access."
          close={() => setModal(null)}
        >
          <form className="live-form" onSubmit={roleCreate}>
            <label>
              Role name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Scope
              <select name="scope">
                <option value="BRANCH">Branch</option>
                <option value="ORGANIZATION">Organization</option>
              </select>
            </label>
            <fieldset>
              <legend>Permissions</legend>
              {permissions.data.map((permission) => (
                <label className="live-check" key={permission.key}>
                  <input
                    type="checkbox"
                    name="permission"
                    value={permission.key}
                  />
                  <span>
                    <strong>{permission.key}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              Reason
              <textarea name="reason" required maxLength={500} />
            </label>
            <button className="live-primary">Create role</button>
          </form>
        </Modal>
      ) : null}
      {modal === "staff" ? (
        <Modal
          title="Create staff account"
          description="The temporary password is never displayed again by this interface."
          close={() => setModal(null)}
        >
          <form className="live-form" onSubmit={staffCreate}>
            <label>
              Display name
              <input name="displayName" required />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Initial password
              <input
                name="initialPassword"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <fieldset>
              <legend>Initial roles</legend>
              {roles.data.map((role) => (
                <label className="live-check" key={role.id}>
                  <input type="checkbox" name="roleId" value={role.id} />
                  <span>
                    <strong>{role.name}</strong>
                    <small>{role.scope}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              Reason
              <textarea name="reason" required />
            </label>
            <button className="live-primary">Create account</button>
          </form>
        </Modal>
      ) : null}
      {modal === "device" ? (
        <Modal
          title="Register device"
          description="The device remains pending until a verified fingerprint is bound."
          close={() => setModal(null)}
        >
          <form className="live-form" onSubmit={deviceCreate}>
            <label>
              Device name
              <input name="name" required />
            </label>
            <button className="live-primary">Register pending device</button>
          </form>
        </Modal>
      ) : null}
      {modal === "staff-action" && selectedStaff ? (
        <Modal
          title={`Manage ${selectedStaff.displayName}`}
          description={`Uses revision ${selectedStaff.revision}; stale mutations are rejected.`}
          close={() => setModal(null)}
        >
          <form className="live-form" onSubmit={staffAction}>
            <label>
              Action
              <select name="action" required>
                <option value="">Choose action</option>
                {selectedStaff.status === "ACTIVE" ? (
                  <option value="disable">Disable and revoke sessions</option>
                ) : (
                  <option value="reactivate">
                    Reactivate; require password change
                  </option>
                )}
                <option value="assign">Assign selected role</option>
                {activeRoles(selectedStaff).map((assignment) => (
                  <option key={assignment.id} value={`remove:${assignment.id}`}>
                    Remove {assignment.role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Role to assign
              <select name="roleId">
                <option value="">Choose role</option>
                {roles.data
                  .filter(
                    (role) =>
                      !activeRoles(selectedStaff).some(
                        (assignment) => assignment.role.id === role.id,
                      ),
                  )
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Reason
              <textarea name="reason" required />
            </label>
            <button className="live-primary">Submit audited change</button>
          </form>
        </Modal>
      ) : null}
      {modal === "device-action" && selectedDevice ? (
        <Modal
          title={
            selectedDevice.status === "PENDING"
              ? `Activate ${selectedDevice.name}`
              : `Revoke ${selectedDevice.name}`
          }
          description={`Uses revision ${selectedDevice.revision}; revocation terminates active sessions.`}
          close={() => setModal(null)}
        >
          <form className="live-form" onSubmit={deviceAction}>
            <input
              type="hidden"
              name="action"
              value={
                selectedDevice.status === "PENDING" ? "activate" : "revoke"
              }
            />
            {selectedDevice.status === "PENDING" ? (
              <label>
                SHA-256 fingerprint hash
                <input
                  name="fingerprintHash"
                  pattern="[a-fA-F0-9]{64}"
                  required
                  autoComplete="off"
                />
              </label>
            ) : null}
            <label>
              Reason
              <textarea name="reason" required />
            </label>
            <button className="live-primary">
              {selectedDevice.status === "PENDING"
                ? "Activate and bind"
                : "Revoke device"}
            </button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
