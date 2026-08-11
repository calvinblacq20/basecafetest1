"use client";

import type {
  MfaEnrollmentResponse,
  MfaStatusResponse,
} from "@base-cafe/contracts";
import { ApiError, type WebSession } from "@base-cafe/web-client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  activateMfa,
  disableMfa,
  enrollMfa,
  getMfaStatus,
  resetPendingMfa,
} from "./admin-client";

function message(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "The MFA request failed.";
}

export function MfaAdministration({ session }: { session: WebSession }) {
  const [status, setStatus] = useState<MfaStatusResponse | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollmentResponse | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async () => setStatus(await getMfaStatus(session)),
    [session],
  );

  useEffect(() => {
    let active = true;
    void getMfaStatus(session)
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch((error) => {
        if (active) setNotice(message(error));
      });
    return () => {
      active = false;
    };
  }, [session]);

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      setEnrollment(
        await enrollMfa(session, {
          currentPassword: String(data.get("currentPassword") ?? ""),
          reason: String(data.get("reason") ?? ""),
        }),
      );
      await refresh();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.revision) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      await activateMfa(session, {
        code: String(data.get("code") ?? ""),
        revision: status.revision,
        reason: String(data.get("reason") ?? ""),
      });
      setEnrollment(null);
      setNotice("Authenticator protection is active for this account.");
      await refresh();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.revision) return;
    const data = new FormData(event.currentTarget);
    const proof = String(data.get("proof") ?? "").trim();
    setBusy(true);
    setNotice("");
    try {
      await disableMfa(session, {
        currentPassword: String(data.get("currentPassword") ?? ""),
        ...(/^\d{6}$/.test(proof)
          ? { code: proof }
          : { recoveryCode: proof.toUpperCase() }),
        revision: status.revision,
        reason: String(data.get("reason") ?? ""),
      });
      setNotice(
        "Authenticator protection was disabled with retained audit history.",
      );
      await refresh();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPending(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.revision) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      await resetPendingMfa(session, {
        currentPassword: String(data.get("currentPassword") ?? ""),
        revision: status.revision,
        reason: String(data.get("reason") ?? ""),
      });
      setEnrollment(null);
      setNotice(
        "Incomplete enrollment was retained as disabled history. You may start again.",
      );
      await refresh();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p>Loading account protection posture…</p>;

  return (
    <>
      <header className="live-heading">
        <div>
          <p className="live-eyebrow">Optional account protection</p>
          <h1>Authenticator MFA</h1>
          <p>
            TOTP secrets are encrypted; recovery codes are stored only as
            one-time hashes.
          </p>
        </div>
        <span
          className={`live-status live-status--${status.status.toLowerCase()}`}
        >
          {status.status.replaceAll("_", " ")}
        </span>
      </header>

      {notice ? (
        <p className="live-blocker" role="status">
          {notice}
        </p>
      ) : null}
      {!status.enrollmentEnabled && status.status !== "ACTIVE" ? (
        <div className="live-blocker">
          <strong>Enrollment disabled by deployment</strong>
          <p>
            No role is forced into MFA. An operator must enable enrollment and
            supply the encryption key.
          </p>
        </div>
      ) : null}

      {status.enrollmentEnabled &&
      ["NOT_ENROLLED", "DISABLED"].includes(status.status) ? (
        <section className="live-form-card">
          <h2>Begin enrollment</h2>
          <form onSubmit={enroll}>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                minLength={12}
                required
              />
            </label>
            <label>
              Reason
              <textarea
                name="reason"
                minLength={3}
                required
                defaultValue="Enable optional authenticator protection."
              />
            </label>
            <button className="live-primary" disabled={busy}>
              Generate protected setup
            </button>
          </form>
        </section>
      ) : null}

      {enrollment ? (
        <section className="live-form-card">
          <h2>Save these recovery codes now</h2>
          <p>
            They are shown for this idempotent enrollment only. Each code works
            once.
          </p>
          <p>
            <strong>Manual authenticator key:</strong>{" "}
            <code>{enrollment.manualEntryKey}</code>
          </p>
          <ul>
            {enrollment.recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <form onSubmit={activate}>
            <label>
              Six-digit authenticator code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required
              />
            </label>
            <label>
              Reason
              <textarea
                name="reason"
                minLength={3}
                required
                defaultValue="Confirm authenticator enrollment."
              />
            </label>
            <button className="live-primary" disabled={busy}>
              Verify and activate
            </button>
          </form>
        </section>
      ) : null}

      {status.status === "PENDING" && !enrollment ? (
        <section className="live-form-card">
          <h2>Incomplete enrollment</h2>
          <p>
            The transient setup response is no longer available. Reset this
            pending record before starting again.
          </p>
          <form onSubmit={resetPending}>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                minLength={12}
                required
              />
            </label>
            <label>
              Reason
              <textarea
                name="reason"
                minLength={3}
                required
                defaultValue="Reset incomplete authenticator enrollment."
              />
            </label>
            <button disabled={busy}>Reset pending enrollment</button>
          </form>
        </section>
      ) : null}

      {status.status === "ACTIVE" ? (
        <section className="live-form-card">
          <h2>Active protection</h2>
          <p>
            {status.recoveryCodesRemaining} unused recovery codes remain. Global
            enforcement is {status.enforcementEnabled ? "enabled" : "disabled"}.
          </p>
          <form onSubmit={disable}>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                minLength={12}
                required
              />
            </label>
            <label>
              Authenticator or recovery code
              <input name="proof" autoComplete="one-time-code" required />
            </label>
            <label>
              Reason
              <textarea
                name="reason"
                minLength={3}
                required
                defaultValue="Disable optional authenticator protection."
              />
            </label>
            <button disabled={busy}>Disable MFA</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
