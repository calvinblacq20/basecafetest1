"use client";

import { Brand } from "@base-cafe/ui";
import { FormEvent, useEffect, useState } from "react";

import type { CashierRuntime } from "./offline/cashier-runtime";

function loginMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "LOGIN_FAILED";
  if (code.startsWith("LOGIN_RATE_LIMITED"))
    return "Too many attempts. Wait before trying again.";
  if (code === "PASSWORD_CHANGE_REQUIRED")
    return "Change the temporary password through an administrator before using this POS.";
  return "The credentials, device ID, or device fingerprint were not accepted.";
}

function unlockMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "OFFLINE_UNLOCK_FAILED";
  const messages: Record<string, string> = {
    OFFLINE_PIN_INCORRECT: "That offline PIN was not accepted.",
    OFFLINE_UNLOCK_RATE_LIMITED:
      "Offline unlock is temporarily locked after repeated attempts.",
    OFFLINE_UNLOCK_LEASE_EXPIRED:
      "The offline access lease expired. Reconnect and sign in with your password.",
    OFFLINE_FULL_LOGIN_REQUIRED:
      "The network is available. Sign in with your full password.",
  };
  return messages[code] ?? "Offline access could not be unlocked.";
}

export function DeviceLogin({
  rememberedEmail,
  onAuthenticated,
}: {
  rememberedEmail?: string;
  onAuthenticated: (runtime: CashierRuntime) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setOnline(navigator.onLine);
      void import("./offline/browser-runtime").then((browser) => {
        if (active)
          setOfflineAvailable(browser.getOfflineUnlockStatus().available);
      });
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      active = false;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const secondFactor = String(data.get("secondFactor") ?? "").trim();
    try {
      const { loginBrowserDevice } = await import("./offline/browser-runtime");
      const runtime = await loginBrowserDevice({
        deviceId: String(data.get("deviceId") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        deviceFingerprintHash:
          String(data.get("fingerprint") ?? "").trim() || undefined,
        ...(secondFactor
          ? /^\d{6}$/.test(secondFactor)
            ? { mfaCode: secondFactor }
            : { mfaRecoveryCode: secondFactor.toUpperCase() }
          : {}),
      });
      onAuthenticated(runtime);
    } catch (caught) {
      setError(loginMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const { unlockBrowserDevice } = await import("./offline/browser-runtime");
      const runtime = await unlockBrowserDevice(String(data.get("pin") ?? ""));
      onAuthenticated(runtime);
    } catch (caught) {
      setError(unlockMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <Brand />
        <div>
          <span className="eyebrow">Enrolled device access</span>
          <h1 id="login-title">
            {!online && offlineAvailable
              ? "Unlock this offline device"
              : "Sign in to start selling"}
          </h1>
          <p>
            {!online && offlineAvailable
              ? "The encrypted local working set can be opened within its approved lease."
              : "Use the device ID issued by an administrator. Credentials are bound to this terminal and protected by account, device, and IP limits."}
          </p>
        </div>
        {!online && offlineAvailable ? (
          <form className="offline-unlock-form" onSubmit={unlock}>
            <div className="offline-unlock-callout">
              <strong>Internet unavailable · local access only</strong>
              <span>
                Server sync and remote actions stay disabled until password
                sign-in returns.
              </span>
            </div>
            <label>
              Offline PIN
              <input
                autoComplete="off"
                inputMode="numeric"
                maxLength={12}
                minLength={6}
                name="pin"
                pattern="[0-9]{6,12}"
                required
                type="password"
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button button--pay"
              disabled={busy}
              type="submit"
            >
              {busy ? "Unlocking…" : "Unlock cached POS"}
            </button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <label>
              Device ID
              <input
                autoComplete="off"
                name="deviceId"
                placeholder="00000000-0000-0000-0000-000000000000"
                required
                type="text"
              />
            </label>
            <label>
              Staff email
              <input
                autoComplete="username"
                defaultValue={rememberedEmail}
                name="email"
                required
                type="email"
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                minLength={12}
                name="password"
                required
                type="password"
              />
            </label>
            <label>
              Authenticator or recovery code <span>(if enabled)</span>
              <input
                autoComplete="one-time-code"
                name="secondFactor"
                type="text"
              />
            </label>
            <details>
              <summary>Device fingerprint</summary>
              <label>
                SHA-256 fingerprint, when configured
                <input
                  autoComplete="off"
                  name="fingerprint"
                  pattern="[a-fA-F0-9]{64}"
                  type="text"
                />
              </label>
            </details>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button button--pay"
              disabled={busy}
              type="submit"
            >
              {busy ? "Signing in…" : "Sign in on this device"}
            </button>
          </form>
        )}
        <small>
          {offlineAvailable
            ? "Offline access is device-bound, time-limited, and never restores a server token."
            : "Offline data remains locked until an approved offline policy is enabled and enrolled online."}
        </small>
      </section>
    </div>
  );
}
