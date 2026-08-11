export type OfflineUnlockPolicy = {
  enabled: boolean;
  leaseExpiresAt: string | null;
  minimumPinLength: number;
  maximumFailedAttempts: number;
  lockoutSeconds: number;
};

export type OfflineUnlockProfile = {
  expiresAt: string;
  offlineAccess: OfflineUnlockPolicy;
  scope: {
    organizationId: string;
    branchId: string;
    deviceId: string;
    userId: string;
  };
  user: {
    displayName: string;
    email: string;
    permissions: string[];
  };
};

type OfflineUnlockRecord = {
  version: 1;
  scope: OfflineUnlockProfile["scope"];
  leaseExpiresAt: string;
  minimumPinLength: number;
  maximumFailedAttempts: number;
  lockoutSeconds: number;
  salt: string;
  iv: string;
  ciphertext: string;
  failedAttempts: number;
  lockedUntil: string | null;
};

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const RECORD_KEY = "base-cafe-pos.offline-unlock.v1";
const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer;
}

function additionalData(
  record: Pick<
    OfflineUnlockRecord,
    | "version"
    | "scope"
    | "leaseExpiresAt"
    | "minimumPinLength"
    | "maximumFailedAttempts"
    | "lockoutSeconds"
  >,
) {
  return encoder.encode(
    JSON.stringify({
      version: record.version,
      scope: record.scope,
      leaseExpiresAt: record.leaseExpiresAt,
      minimumPinLength: record.minimumPinLength,
      maximumFailedAttempts: record.maximumFailedAttempts,
      lockoutSeconds: record.lockoutSeconds,
    }),
  );
}

async function encryptionKey(pin: string, salt: Uint8Array) {
  const source = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: arrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function read(storage: KeyValueStorage): OfflineUnlockRecord | null {
  try {
    const value = JSON.parse(
      storage.getItem(RECORD_KEY) ?? "null",
    ) as OfflineUnlockRecord | null;
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function assertPin(pin: string, minimum: number) {
  if (!new RegExp(`^\\d{${minimum},12}$`).test(pin))
    throw new Error("OFFLINE_PIN_INVALID_FORMAT");
}

export function offlineUnlockStatus(
  storage: KeyValueStorage,
  now = new Date(),
) {
  const record = read(storage);
  if (!record) return { available: false, lockedUntil: null, expiresAt: null };
  const expired = new Date(record.leaseExpiresAt).getTime() <= now.getTime();
  return {
    available: !expired,
    lockedUntil: record.lockedUntil,
    expiresAt: record.leaseExpiresAt,
  };
}

export async function enrollOfflineUnlock(
  storage: KeyValueStorage,
  profile: OfflineUnlockProfile,
  pin: string,
) {
  const policy = profile.offlineAccess;
  if (!policy.enabled || !policy.leaseExpiresAt)
    throw new Error("OFFLINE_UNLOCK_DISABLED");
  if (new Date(policy.leaseExpiresAt).getTime() <= Date.now())
    throw new Error("OFFLINE_UNLOCK_LEASE_EXPIRED");
  assertPin(pin, policy.minimumPinLength);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const record: OfflineUnlockRecord = {
    version: 1,
    scope: profile.scope,
    leaseExpiresAt: policy.leaseExpiresAt,
    minimumPinLength: policy.minimumPinLength,
    maximumFailedAttempts: policy.maximumFailedAttempts,
    lockoutSeconds: policy.lockoutSeconds,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: "",
    failedAttempts: 0,
    lockedUntil: null,
  };
  const key = await encryptionKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: arrayBuffer(iv),
      additionalData: additionalData(record),
    },
    key,
    encoder.encode(JSON.stringify(profile)),
  );
  storage.setItem(
    RECORD_KEY,
    JSON.stringify({
      ...record,
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    }),
  );
}

export async function unlockOfflineProfile(
  storage: KeyValueStorage,
  pin: string,
  expectedDeviceId?: string,
  now = new Date(),
) {
  const record = read(storage);
  if (!record) throw new Error("OFFLINE_UNLOCK_NOT_ENROLLED");
  if (new Date(record.leaseExpiresAt).getTime() <= now.getTime()) {
    storage.removeItem(RECORD_KEY);
    throw new Error("OFFLINE_UNLOCK_LEASE_EXPIRED");
  }
  if (expectedDeviceId && record.scope.deviceId !== expectedDeviceId)
    throw new Error("OFFLINE_UNLOCK_DEVICE_MISMATCH");
  if (
    record.lockedUntil &&
    new Date(record.lockedUntil).getTime() > now.getTime()
  )
    throw new Error("OFFLINE_UNLOCK_RATE_LIMITED");
  assertPin(pin, record.minimumPinLength);

  try {
    const key = await encryptionKey(pin, base64ToBytes(record.salt));
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: arrayBuffer(base64ToBytes(record.iv)),
        additionalData: additionalData(record),
      },
      key,
      arrayBuffer(base64ToBytes(record.ciphertext)),
    );
    const profile = JSON.parse(
      decoder.decode(plaintext),
    ) as OfflineUnlockProfile;
    if (
      profile.scope.deviceId !== record.scope.deviceId ||
      profile.scope.userId !== record.scope.userId ||
      profile.offlineAccess.leaseExpiresAt !== record.leaseExpiresAt
    )
      throw new Error("OFFLINE_UNLOCK_ENVELOPE_INVALID");
    storage.setItem(
      RECORD_KEY,
      JSON.stringify({ ...record, failedAttempts: 0, lockedUntil: null }),
    );
    return profile;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "OFFLINE_UNLOCK_ENVELOPE_INVALID"
    )
      throw error;
    const failedAttempts = record.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= record.maximumFailedAttempts
        ? new Date(now.getTime() + record.lockoutSeconds * 1_000).toISOString()
        : null;
    storage.setItem(
      RECORD_KEY,
      JSON.stringify({ ...record, failedAttempts, lockedUntil }),
    );
    throw new Error(
      lockedUntil ? "OFFLINE_UNLOCK_RATE_LIMITED" : "OFFLINE_PIN_INCORRECT",
    );
  }
}

export function clearOfflineUnlock(storage: KeyValueStorage) {
  storage.removeItem(RECORD_KEY);
}
