"use client";

import {
  offlineAccessPolicySchema,
  type LoginRequest,
} from "@base-cafe/contracts";
import { loginDevice, normalizeApiOrigin } from "@base-cafe/web-client";

import { CashierRuntime, type RuntimeSession } from "./cashier-runtime";
import { IndexedDbSyncStore } from "./indexeddb-sync-store";
import {
  clearOfflineUnlock,
  enrollOfflineUnlock,
  offlineUnlockStatus,
  unlockOfflineProfile,
} from "./offline-unlock";
import {
  createHttpSyncRecoveryTransport,
  createHttpSyncTransport,
  SyncEngine,
} from "./sync-engine";

const PROFILE_KEY = "base-cafe-pos.session-profile.v1";
const TOKEN_KEY = "base-cafe-pos.access-token";
let runtime: CashierRuntime | null | undefined;

export type StoredProfile = Omit<
  RuntimeSession,
  "accessToken" | "offlineUnlocked"
>;

function apiBaseUrl() {
  return normalizeApiOrigin(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100",
  );
}

function storedProfile(): StoredProfile | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(PROFILE_KEY) ?? "null",
    ) as StoredProfile | null;
    if (
      !value?.scope.organizationId ||
      !value.scope.branchId ||
      !value.scope.deviceId ||
      !value.scope.userId ||
      new Date(value.expiresAt).getTime() <= Date.now()
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function createRuntime(session: RuntimeSession) {
  const store = new IndexedDbSyncStore(session.scope);
  const token = () => sessionStorage.getItem(TOKEN_KEY);
  const engine = new SyncEngine(
    store,
    createHttpSyncTransport(apiBaseUrl(), token),
    () => navigator.onLine,
    undefined,
    createHttpSyncRecoveryTransport(apiBaseUrl(), token),
  );
  return new CashierRuntime(session, store, engine, apiBaseUrl());
}

export function getStoredSessionProfile() {
  return storedProfile();
}

export function getOfflineUnlockStatus() {
  return offlineUnlockStatus(localStorage);
}

export function getBrowserCashierRuntime() {
  if (runtime !== undefined) return runtime;
  const profile = storedProfile();
  const accessToken = sessionStorage.getItem(TOKEN_KEY);
  if (!profile || !accessToken) return (runtime = null);
  return (runtime = createRuntime({ ...profile, accessToken }));
}

export async function loginBrowserDevice(input: LoginRequest) {
  const value = await loginDevice(`${apiBaseUrl()}/api/v1`, input);
  if (value.user.mustChangePassword)
    throw new Error("PASSWORD_CHANGE_REQUIRED");
  const profile: StoredProfile = {
    expiresAt: value.expiresAt,
    offlineAccess: value.offlineAccess,
    scope: { ...value.scope, userId: value.user.id },
    user: {
      displayName: value.user.displayName,
      email: value.user.email,
      permissions: value.user.permissions,
    },
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  sessionStorage.setItem(TOKEN_KEY, value.accessToken);
  if (!profile.offlineAccess.enabled) clearOfflineUnlock(localStorage);
  runtime = createRuntime({ ...profile, accessToken: value.accessToken });
  return runtime;
}

export async function configureBrowserOfflineUnlock(pin: string) {
  const profile = storedProfile();
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!profile || !token || !navigator.onLine)
    throw new Error("OFFLINE_UNLOCK_REQUIRES_ONLINE_SESSION");
  const commandId = crypto.randomUUID();
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/auth/offline-unlock/enroll`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `offline-unlock:${commandId}`,
      },
      body: JSON.stringify({
        branchId: profile.scope.branchId,
        reason: "Staff enrolled bounded offline restart access.",
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "OFFLINE_UNLOCK_POLICY_OR_RECENT_LOGIN_REQUIRED"
        : `OFFLINE_UNLOCK_HTTP_${response.status}`,
    );
  const offlineAccess = offlineAccessPolicySchema.parse(await response.json());
  const refreshed = { ...profile, offlineAccess };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(refreshed));
  await enrollOfflineUnlock(localStorage, refreshed, pin);
  return offlineUnlockStatus(localStorage);
}

export async function unlockBrowserDevice(pin: string) {
  if (navigator.onLine) throw new Error("OFFLINE_FULL_LOGIN_REQUIRED");
  const remembered = storedProfile();
  const profile = await unlockOfflineProfile(
    localStorage,
    pin,
    remembered?.scope.deviceId,
  );
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  runtime = createRuntime({
    ...profile,
    accessToken: "",
    offlineUnlocked: true,
  });
  return runtime;
}

export function lockBrowserDevice() {
  sessionStorage.removeItem(TOKEN_KEY);
  runtime = null;
}

export async function logoutBrowserDevice() {
  const accessToken = sessionStorage.getItem(TOKEN_KEY);
  if (accessToken && navigator.onLine) {
    await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    }).catch(() => undefined);
  }
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  clearOfflineUnlock(localStorage);
  runtime = null;
}

export async function registerOfflineShell() {
  if (!("serviceWorker" in navigator)) return null;
  if (process.env.NODE_ENV !== "production") {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) =>
          registration.scope.startsWith(location.origin),
        )
        .map((registration) => registration.unregister()),
    );
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("base-cafe-pos-shell-"))
          .map((key) => caches.delete(key)),
      );
    }
    return null;
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}
