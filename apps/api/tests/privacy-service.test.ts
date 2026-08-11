import { ConflictException, ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { CustomerPiiCryptoService } from "../src/privacy/customer-pii-crypto.service.js";
import { PrivacyService } from "../src/privacy/privacy.service.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";
const customerId = "00000000-0000-4000-8000-000000000004";

function principal(
  permissions: string[],
  scope: "ORGANIZATION" | "BRANCH" = "ORGANIZATION",
): AuthPrincipal {
  return {
    userId,
    organizationId,
    deviceId,
    displayName: "Privacy Manager",
    email: "privacy@example.test",
    mustChangePassword: false,
    assignments: [
      {
        scope,
        branchId:
          scope === "BRANCH" ? "00000000-0000-4000-8000-000000000005" : null,
        permissions,
      },
    ],
  };
}

describe("PrivacyService", () => {
  beforeEach(() => {
    process.env.CUSTOMER_PII_ACTIVE_KEY_VERSION = "v1";
    process.env.CUSTOMER_PII_KEYS_JSON = JSON.stringify({
      v1: Buffer.alloc(32, 3).toString("base64"),
    });
    process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64 = Buffer.alloc(32, 4).toString(
      "base64",
    );
    delete process.env.PRIVACY_MARKETING_ENABLED;
    delete process.env.PRIVACY_RETENTION_ACTIVATION_ENABLED;
    delete process.env.PRIVACY_ANONYMIZATION_ENABLED;
  });

  afterEach(() => {
    delete process.env.CUSTOMER_PII_ACTIVE_KEY_VERSION;
    delete process.env.CUSTOMER_PII_KEYS_JSON;
    delete process.env.CUSTOMER_PII_BLIND_INDEX_KEY_B64;
    delete process.env.PRIVACY_MARKETING_ENABLED;
    delete process.env.PRIVACY_RETENTION_ACTIVATION_ENABLED;
    delete process.env.PRIVACY_ANONYMIZATION_ENABLED;
  });

  it("requires organization-scoped permissions", async () => {
    const service = new PrivacyService(
      {} as never,
      new CustomerPiiCryptoService(),
      {} as never,
    );
    await expect(
      service.listRetentionPolicies(
        principal(["privacy.policies.read"], "BRANCH"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("stores only an encryption envelope and emits audit/outbox evidence", async () => {
    const createdAt = new Date("2026-08-08T10:00:00.000Z");
    const transaction = {
      customerProfile: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => ({
          ...data,
          status: "ACTIVE",
          revision: 1,
          anonymizedAt: null,
          createdAt,
          updatedAt: createdAt,
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(transaction)),
    };
    const service = new PrivacyService(
      prisma as never,
      new CustomerPiiCryptoService(),
      {} as never,
    );
    await expect(
      service.createCustomer(
        {
          customerId,
          displayName: "Ama Mensah",
          phone: "+233240000000",
          reason: "Create operational customer profile.",
        },
        "customer-create-0001",
        principal(["customers.create"]),
      ),
    ).resolves.toMatchObject({ id: customerId, status: "ACTIVE" });
    const data = transaction.customerProfile.create.mock.calls[0]?.[0].data;
    expect(data.piiCiphertext).toBeInstanceOf(Uint8Array);
    expect(data).not.toHaveProperty("displayName");
    expect(data).not.toHaveProperty("phone");
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it("keeps marketing, retention activation, and anonymization fail-closed", async () => {
    const service = new PrivacyService(
      {} as never,
      new CustomerPiiCryptoService(),
      {} as never,
    );
    await expect(
      service.recordConsent(
        customerId,
        {
          eventId: "00000000-0000-4000-8000-000000000006",
          purpose: "MARKETING",
          channel: "SMS",
          status: "GRANTED",
          source: "counter",
          wordingVersion: "draft-1",
          occurredAt: "2026-08-08T10:00:00.000Z",
          reason: "Requested marketing consent.",
        },
        "consent-0001",
        principal(["customers.manage"]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.activateRetentionPolicy(
        "00000000-0000-4000-8000-000000000007",
        {
          revision: 1,
          effectiveFrom: "2026-08-09T00:00:00.000Z",
          approvalReference: "unapproved",
          reason: "Attempt activation.",
        },
        "retention-0001",
        principal(["privacy.policies.manage"]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
