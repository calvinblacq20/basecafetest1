import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CustomerPiiCryptoService } from "../src/privacy/customer-pii-crypto.service.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  resourceType: "customer-profile",
  resourceId: "00000000-0000-4000-8000-000000000002",
};

const original = {
  version: process.env.CUSTOMER_PII_ACTIVE_KEY_VERSION,
  keys: process.env.CUSTOMER_PII_KEYS_JSON,
  blind: process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64,
};

describe("CustomerPiiCryptoService", () => {
  beforeEach(() => {
    process.env.CUSTOMER_PII_ACTIVE_KEY_VERSION = "v1";
    process.env.CUSTOMER_PII_KEYS_JSON = JSON.stringify({
      v1: Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64 = Buffer.alloc(32, 9).toString(
      "base64",
    );
  });

  afterEach(() => {
    for (const [name, value] of [
      ["CUSTOMER_PII_ACTIVE_KEY_VERSION", original.version],
      ["CUSTOMER_PII_KEYS_JSON", original.keys],
      ["CUSTOMER_PII_BLIND_INDEX_KEY_B64", original.blind],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("round-trips authenticated PII without placing plaintext in the envelope", () => {
    const service = new CustomerPiiCryptoService();
    const value = { displayName: "Ama", phone: "+233 24 000 0000" };
    const envelope = service.protect(value, context)!;
    expect(Buffer.from(envelope.ciphertext).toString("utf8")).not.toContain(
      "Ama",
    );
    expect(service.unprotect(envelope, context)).toEqual(value);
  });

  it("normalizes exact phone and email blind indexes deterministically", () => {
    const service = new CustomerPiiCryptoService();
    expect(service.phoneBlindIndex("+233 24-000-0000")).toBe(
      service.phoneBlindIndex("+233240000000"),
    );
    expect(service.emailBlindIndex(" AMA@Example.COM ")).toBe(
      service.emailBlindIndex("ama@example.com"),
    );
  });

  it("rejects tampering and refuses to operate without explicit keys", () => {
    const service = new CustomerPiiCryptoService();
    const envelope = service.protect({ displayName: "Ama" }, context)!;
    envelope.ciphertext[0] = (envelope.ciphertext[0] ?? 0) ^ 1;
    expect(() => service.unprotect(envelope, context)).toThrow();
    delete process.env.CUSTOMER_PII_KEYS_JSON;
    expect(() => service.protect({ displayName: "Ama" }, context)).toThrow();
  });
});
