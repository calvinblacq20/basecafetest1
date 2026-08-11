import { describe, expect, it } from "vitest";

import {
  confirmTaxProfileRequestSchema,
  createTaxProfileRequestSchema,
  ghanaVatReference2026,
  ghanaVatReferenceSchema,
  taxProfileResponseSchema,
  updateTaxProfileRequestSchema,
} from "../src/tax.js";

const branchId = "10000000-0000-4000-8000-000000000002";

function validProfile() {
  return {
    branchId,
    key: "ACCOUNTANT_APPROVED_V1",
    name: "Accountant-approved profile",
    priceMode: "INCLUSIVE",
    roundingMode: "HALF_UP",
    roundingScope: "LINE",
    effectiveFrom: "2026-08-07T00:00:00.000Z",
    components: [
      {
        code: "COMPONENT_A",
        receiptLabel: "Approved component A",
        ratePpm: 10_000,
        calculationOrder: 0,
      },
    ],
    reason: "Create a staging profile from approved evidence.",
  };
}

describe("tax profile contracts", () => {
  it("rejects duplicate component codes and calculation order", () => {
    const input = validProfile();
    const result = createTaxProfileRequestSchema.safeParse({
      ...input,
      components: [
        ...input.components,
        { ...input.components[0], receiptLabel: "Duplicate" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects reversed effective intervals", () => {
    const result = createTaxProfileRequestSchema.safeParse({
      ...validProfile(),
      effectiveTo: "2026-08-06T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires a material draft update", () => {
    const result = updateTaxProfileRequestSchema.safeParse({
      branchId,
      revision: 1,
      reason: "No material change.",
    });
    expect(result.success).toBe(false);
  });

  it("requires an explicit approval evidence reference", () => {
    const result = confirmTaxProfileRequestSchema.safeParse({
      branchId,
      revision: 1,
      approvalReference: " ",
      reason: "Record approval.",
    });
    expect(result.success).toBe(false);
  });

  it("keeps the official GRA 2026 values reference-only", () => {
    expect(ghanaVatReferenceSchema.parse(ghanaVatReference2026)).toEqual(
      ghanaVatReference2026,
    );
    expect(ghanaVatReference2026.effectiveFrom).toBe("2026-01-01");
    expect(ghanaVatReference2026.components).toEqual([
      expect.objectContaining({
        code: "VAT",
        ratePpm: 150_000,
        commonBase: true,
      }),
      expect.objectContaining({
        code: "NHIL",
        ratePpm: 25_000,
        commonBase: true,
      }),
      expect.objectContaining({
        code: "GETFUND",
        ratePpm: 25_000,
        commonBase: true,
      }),
    ]);
    expect(ghanaVatReference2026.covid19HealthRecoveryLevyIncluded).toBe(false);
    expect(ghanaVatReference2026.fillsPriceMode).toBe(false);
    expect(ghanaVatReference2026.fillsRounding).toBe(false);
    expect(ghanaVatReference2026.activationAllowed).toBe(false);
    expect(ghanaVatReference2026.source.url).toMatch(
      /^https:\/\/gra\.gov\.gh\//,
    );
  });

  it("parses a stable tax profile projection without approval details", () => {
    const now = "2026-08-09T12:00:00.000Z";
    const response = taxProfileResponseSchema.parse({
      id: "10000000-0000-4000-8000-000000000030",
      branchId,
      key: "DRAFT_V1",
      name: "Draft profile",
      status: "DRAFT",
      priceMode: "EXCLUSIVE",
      roundingMode: "HALF_UP",
      roundingScope: "LINE",
      currency: "GHS",
      effectiveFrom: now,
      effectiveTo: null,
      revision: 1,
      approvalRecorded: false,
      approvalReference: "must not cross the public contract",
      confirmedAt: null,
      activatedAt: null,
      createdAt: now,
      updatedAt: now,
      components: [
        {
          id: "10000000-0000-4000-8000-000000000031",
          code: "VAT",
          receiptLabel: "VAT",
          ratePpm: 150_000,
          calculationOrder: 0,
          createdAt: now,
        },
      ],
    });
    expect(response).not.toHaveProperty("approvalReference");
  });
});
