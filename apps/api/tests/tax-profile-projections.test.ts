import { describe, expect, it, vi } from "vitest";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { TaxService } from "../src/tax/tax.service.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const principal: AuthPrincipal = {
  userId: "10000000-0000-4000-8000-000000000010",
  organizationId: "10000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000003",
  displayName: "Fictional administrator",
  email: "admin@example.test",
  mustChangePassword: false,
  assignments: [{ branchId, scope: "BRANCH", permissions: ["tax.read"] }],
};

describe("tax profile response projections", () => {
  it("exposes stable configuration facts without actor IDs or approval reference", async () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ id: branchId }) },
      taxProfile: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "10000000-0000-4000-8000-000000000030",
            branchId,
            createdById: principal.userId,
            confirmationRecordedById: principal.userId,
            activatedById: null,
            key: "REFERENCE_DRAFT",
            name: "Reference draft",
            status: "CONFIRMED",
            priceMode: "EXCLUSIVE",
            roundingMode: "HALF_UP",
            roundingScope: "LINE",
            currency: "GHS",
            effectiveFrom: now,
            effectiveTo: null,
            revision: 2,
            approvalReference: "private-accountant-reference",
            confirmedAt: now,
            activatedAt: null,
            createdAt: now,
            updatedAt: now,
            components: [
              {
                id: "10000000-0000-4000-8000-000000000031",
                taxProfileId: "10000000-0000-4000-8000-000000000030",
                code: "VAT",
                receiptLabel: "VAT",
                ratePpm: 150_000,
                calculationOrder: 0,
                createdAt: now,
              },
            ],
          },
        ]),
      },
    };

    const [result] = await new TaxService(prisma as never).listProfiles(
      branchId,
      principal,
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("Expected one projected profile.");
    expect(result).toMatchObject({
      key: "REFERENCE_DRAFT",
      approvalRecorded: true,
      components: [{ code: "VAT", ratePpm: 150_000 }],
    });
    expect(result).not.toHaveProperty("approvalReference");
    expect(result).not.toHaveProperty("createdById");
    expect(result).not.toHaveProperty("confirmationRecordedById");
    expect(result.components[0]).not.toHaveProperty("taxProfileId");
  });
});
