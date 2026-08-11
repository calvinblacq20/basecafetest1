import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { ConflictException, Injectable } from "@nestjs/common";

export type CustomerPii = Readonly<{
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  preferredContactChannel?: string | null;
  deliveryDirections?: string | null;
}>;

export type PiiEnvelope = Readonly<{
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyVersion: string;
}>;

type PiiContext = Readonly<{
  organizationId: string;
  resourceType: string;
  resourceId: string;
}>;

function configurationError(
  code = "CUSTOMER_PII_CONFIGURATION_MISSING",
): never {
  throw new ConflictException({
    code,
    message: "Customer-data encryption is not configured for this operation.",
  });
}

@Injectable()
export class CustomerPiiCryptoService {
  posture() {
    try {
      const { activeVersion, keys } = this.keyRing();
      const blindIndexKey = process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64;
      return {
        configured: Boolean(
          keys.get(activeVersion) &&
          blindIndexKey &&
          Buffer.from(blindIndexKey, "base64").length === 32,
        ),
        activeKeyVersion: activeVersion,
        readableKeyVersions: [...keys.keys()].sort(),
      };
    } catch {
      return {
        configured: false,
        activeKeyVersion: null,
        readableKeyVersions: [] as string[],
      };
    }
  }

  activeKeyVersion() {
    return this.keyRing().activeVersion;
  }

  protect(value: CustomerPii, context: PiiContext): PiiEnvelope | null {
    const compact = Object.fromEntries(
      Object.entries(value).filter(
        ([, field]) => field !== null && field !== undefined,
      ),
    );
    if (Object.keys(compact).length === 0) return null;

    const { activeVersion, keys } = this.keyRing();
    const key = keys.get(activeVersion);
    if (!key) configurationError();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(this.aad(context, activeVersion), "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(compact), "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: Uint8Array.from(ciphertext),
      iv: Uint8Array.from(iv),
      authTag: Uint8Array.from(cipher.getAuthTag()),
      keyVersion: activeVersion,
    };
  }

  unprotect(envelope: PiiEnvelope, context: PiiContext): CustomerPii {
    const { keys } = this.keyRing();
    const key = keys.get(envelope.keyVersion);
    if (!key) configurationError("CUSTOMER_PII_KEY_VERSION_UNAVAILABLE");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv),
      );
      decipher.setAAD(
        Buffer.from(this.aad(context, envelope.keyVersion), "utf8"),
      );
      decipher.setAuthTag(Buffer.from(envelope.authTag));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext)),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(plaintext) as CustomerPii;
    } catch {
      throw new ConflictException({
        code: "CUSTOMER_PII_DECRYPTION_FAILED",
        message: "The protected customer data could not be authenticated.",
      });
    }
  }

  phoneBlindIndex(value: string | null | undefined) {
    return value
      ? this.blindIndex(`phone:${this.normalizePhone(value)}`)
      : null;
  }

  emailBlindIndex(value: string | null | undefined) {
    return value
      ? this.blindIndex(`email:${value.trim().toLowerCase()}`)
      : null;
  }

  normalizePhone(value: string) {
    const trimmed = value.trim();
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 20)
      throw new ConflictException({
        code: "CUSTOMER_PHONE_INVALID",
        message: "Phone numbers must contain between 7 and 20 digits.",
      });
    return `${hasPlus ? "+" : ""}${digits}`;
  }

  private blindIndex(value: string) {
    const encoded = process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64;
    if (!encoded) configurationError();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) configurationError();
    return createHmac("sha256", key).update(value, "utf8").digest("hex");
  }

  private keyRing() {
    const activeVersion = process.env.CUSTOMER_PII_ACTIVE_KEY_VERSION?.trim();
    const encodedRing = process.env.CUSTOMER_PII_KEYS_JSON;
    if (!activeVersion || !encodedRing) configurationError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(encodedRing);
    } catch {
      configurationError();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      configurationError();
    const keys = new Map<string, Buffer>();
    for (const [version, encoded] of Object.entries(parsed)) {
      if (typeof encoded !== "string") configurationError();
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32) configurationError();
      keys.set(version, key);
    }
    return { activeVersion, keys };
  }

  private aad(context: PiiContext, version: string) {
    return [
      "base-cafe-customer-pii-v1",
      context.organizationId,
      context.resourceType,
      context.resourceId,
      version,
    ].join(":");
  }
}
