import { describe, expect, it } from "vitest";

import {
  enrollOfflineUnlock,
  offlineUnlockStatus,
  type OfflineUnlockProfile,
  unlockOfflineProfile,
} from "./offline-unlock";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const profile: OfflineUnlockProfile = {
  expiresAt: "2099-08-07T20:00:00.000Z",
  offlineAccess: {
    enabled: true,
    leaseExpiresAt: "2099-08-07T16:00:00.000Z",
    minimumPinLength: 6,
    maximumFailedAttempts: 3,
    lockoutSeconds: 300,
  },
  scope: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    branchId: "00000000-0000-4000-8000-000000000002",
    deviceId: "00000000-0000-4000-8000-000000000003",
    userId: "00000000-0000-4000-8000-000000000004",
  },
  user: {
    displayName: "Offline Cashier",
    email: "cashier@example.test",
    permissions: ["orders.create"],
  },
};

describe("offline restart unlock", () => {
  it("encrypts the safe profile and decrypts it only for the bound device", async () => {
    const storage = new MemoryStorage();
    await enrollOfflineUnlock(storage, profile, "731904");

    const serialized = [...storage.values.values()].join("");
    expect(serialized).not.toContain(profile.user.displayName);
    expect(serialized).not.toContain(profile.user.email);
    expect(offlineUnlockStatus(storage).available).toBe(true);

    await expect(
      unlockOfflineProfile(storage, "731904", profile.scope.deviceId),
    ).resolves.toMatchObject({ scope: profile.scope, user: profile.user });
    await expect(
      unlockOfflineProfile(
        storage,
        "731904",
        "00000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow("OFFLINE_UNLOCK_DEVICE_MISMATCH");
  });

  it("enforces the server-issued lease before attempting decryption", async () => {
    const storage = new MemoryStorage();
    await enrollOfflineUnlock(storage, profile, "731904");
    await expect(
      unlockOfflineProfile(
        storage,
        "731904",
        profile.scope.deviceId,
        new Date("2100-01-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("OFFLINE_UNLOCK_LEASE_EXPIRED");
    expect(offlineUnlockStatus(storage).available).toBe(false);
  });
});
