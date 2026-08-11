import { describe, expect, it } from "vitest";

import { createIntegrationRegistry } from "../src/index";

const context = {
  organizationId: "organization",
  branchId: "branch",
  idempotencyKey: "command-1",
  requestedAt: "2026-08-10T00:00:00.000Z",
};

describe("safe integration adapter boundaries", () => {
  it("defaults every external integration to disabled", async () => {
    const registry = createIntegrationRegistry({});
    await expect(
      registry.psp.createIntent(context, {
        amountPesewas: 100,
        currency: "GHS",
      }),
    ).resolves.toMatchObject({
      status: "DISABLED",
      code: "PSP_ADAPTER_DISABLED",
    });
    await expect(
      registry.fiscal.submitCommercialSnapshot(context, {
        receiptId: "receipt",
        snapshotHash: "hash",
      }),
    ).resolves.toMatchObject({ status: "DISABLED" });
  });

  it("makes fictional adapters conspicuously test-only", async () => {
    const registry = createIntegrationRegistry({
      ALLOW_FICTIONAL_INTEGRATION_ADAPTERS: "true",
      PSP_ADAPTER: "fictional-test",
      GRA_FISCAL_ADAPTER: "fictional-test",
      PRINTER_ADAPTER: "fictional-test",
      NOTIFICATION_ADAPTER: "fictional-test",
    });
    await expect(
      registry.psp.createIntent(context, {
        amountPesewas: 100,
        currency: "GHS",
      }),
    ).resolves.toMatchObject({
      status: "TEST_ONLY",
      testOnly: true,
      value: { providerReference: "FICTIONAL-PSP-command-1" },
    });
    await expect(
      registry.fiscal.submitCommercialSnapshot(context, {
        receiptId: "receipt",
        snapshotHash: "hash",
      }),
    ).resolves.toMatchObject({
      status: "TEST_ONLY",
      value: { watermark: "FICTIONAL TEST ADAPTER — NOT A FISCAL RECEIPT" },
    });
  });

  it("rejects fictional adapters in production", () => {
    expect(() =>
      createIntegrationRegistry({
        NODE_ENV: "production",
        ALLOW_FICTIONAL_INTEGRATION_ADAPTERS: "true",
        PSP_ADAPTER: "fictional-test",
      }),
    ).toThrow(/PSP_ADAPTER_UNAVAILABLE/);
  });
});
