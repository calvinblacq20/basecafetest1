import { describe, expect, it } from "vitest";

import {
  loginRequestSchema,
  mfaActivationRequestSchema,
  mfaDisableRequestSchema,
  mfaEnrollmentResponseSchema,
  mfaPendingResetRequestSchema,
} from "../src/index.js";

describe("MFA contracts", () => {
  it("accepts one login second factor but never two", () => {
    const base = {
      email: "owner@example.test",
      password: "correct horse battery staple",
      deviceId: "00000000-0000-4000-8000-000000000001",
    };
    expect(
      loginRequestSchema.parse({ ...base, mfaCode: "123456" }).mfaCode,
    ).toBe("123456");
    expect(() =>
      loginRequestSchema.parse({
        ...base,
        mfaCode: "123456",
        mfaRecoveryCode: "ABCD-EFGH-IJKL-MNOP",
      }),
    ).toThrow();
  });

  it("requires revision and reason for activation and exactly one disable proof", () => {
    expect(
      mfaActivationRequestSchema.parse({
        code: "123456",
        revision: 1,
        reason: "Owner enabled optional account protection.",
      }).revision,
    ).toBe(1);
    expect(() =>
      mfaDisableRequestSchema.parse({
        currentPassword: "correct horse battery staple",
        revision: 2,
        reason: "Replacing the registered authenticator.",
      }),
    ).toThrow();
    expect(
      mfaPendingResetRequestSchema.parse({
        currentPassword: "correct horse battery staple",
        revision: 1,
        reason: "Reset an incomplete authenticator enrollment.",
      }).revision,
    ).toBe(1);
  });

  it("requires eight one-time recovery codes in an enrollment response", () => {
    const recoveryCodes = [
      "ABCD-EFGH-IJKL-MNPA",
      "ABCD-EFGH-IJKL-MNPB",
      "ABCD-EFGH-IJKL-MNPC",
      "ABCD-EFGH-IJKL-MNPD",
      "ABCD-EFGH-IJKL-MNPE",
      "ABCD-EFGH-IJKL-MNPF",
      "ABCD-EFGH-IJKL-MNPG",
      "ABCD-EFGH-IJKL-MNPH",
    ];
    expect(
      mfaEnrollmentResponseSchema.parse({
        status: "PENDING",
        revision: 1,
        manualEntryKey: "JBSWY3DPEHPK3PXP",
        otpauthUri: "otpauth://totp/Base%20Cafe?secret=JBSWY3DPEHPK3PXP",
        recoveryCodes,
      }).recoveryCodes,
    ).toHaveLength(8);
    expect(() =>
      mfaEnrollmentResponseSchema.parse({
        status: "PENDING",
        revision: 1,
        manualEntryKey: "JBSWY3DPEHPK3PXP",
        otpauthUri: "otpauth://totp/Base%20Cafe?secret=JBSWY3DPEHPK3PXP",
        recoveryCodes: recoveryCodes.slice(0, 7),
      }),
    ).toThrow();
  });
});
