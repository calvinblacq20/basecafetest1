import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  decryptMfaSecret,
  deterministicRecoveryCodes,
  encryptMfaSecret,
  recoveryCodeHash,
  totpCode,
  verifyTotp,
} from "../src/auth/mfa-totp.js";

const environment = {
  MFA_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString("base64"),
};

describe("TOTP MFA primitives", () => {
  it("matches the six-digit RFC 6238 SHA-1 result at 59 seconds", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    expect(totpCode(secret, new Date(59_000))).toBe("287082");
    expect(verifyTotp(secret, "287082", new Date(59_000))).toBe(true);
    expect(base32Decode(secret).toString("ascii")).toBe("12345678901234567890");
  });

  it("accepts only the adjacent 30-second drift window", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const at = new Date("2026-08-10T12:00:00.000Z");
    expect(verifyTotp(secret, totpCode(secret, at, -1), at)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, at, 2), at)).toBe(false);
  });

  it("encrypts secrets and derives stable, non-plaintext recovery hashes", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptMfaSecret(secret, environment);
    expect(encrypted.toString()).not.toContain(secret);
    expect(decryptMfaSecret(encrypted, environment)).toBe(secret);

    const codes = deterministicRecoveryCodes(
      secret,
      "mfa-enrollment-command-0001",
    );
    expect(new Set(codes).size).toBe(8);
    expect(
      codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)),
    ).toBe(true);
    expect(recoveryCodeHash(secret, codes[0]!)).toMatch(/^[a-f0-9]{64}$/);
    expect(recoveryCodeHash(secret, codes[0]!)).not.toContain(codes[0]!);
  });
});
