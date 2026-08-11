import { describe, expect, it } from "vitest";
import {
  inventoryDeductionPolicyResponseSchema,
  inventoryConsumptionListQuerySchema,
  postInventoryConsumptionSchema,
  reverseInventoryConsumptionSchema,
} from "../src/inventory-consumption.js";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("inventory consumption contracts", () => {
  it("rejects duplicate stock targets in a posting command", () => {
    const result = postInventoryConsumptionSchema.safeParse({
      consumptionId: id(1),
      branchId: id(2),
      orderLineId: id(3),
      sourceEventId: id(4),
      trigger: "SENT",
      reason: "Post recipe consumption",
      ledgerEntries: [
        { inventoryItemId: id(5), locationId: id(6), ledgerEntryId: id(7) },
        { inventoryItemId: id(5), locationId: id(6), ledgerEntryId: id(8) },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate reversal ledger IDs", () => {
    const result = reverseInventoryConsumptionSchema.safeParse({
      reversalId: id(1),
      branchId: id(2),
      consumptionRevision: 1,
      reason: "Reverse cancelled sent line",
      ledgerEntries: [
        { consumptionEntryId: id(3), ledgerEntryId: id(5) },
        { consumptionEntryId: id(4), ledgerEntryId: id(5) },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("parses the false query value without coercing it to true", () => {
    expect(
      inventoryConsumptionListQuerySchema.parse({ reversed: "false" }),
    ).toMatchObject({ reversed: false, limit: 100 });
  });

  it("omits internal actor identifiers from public policy records", () => {
    const parsed = inventoryDeductionPolicyResponseSchema.parse({
      id: id(1),
      branchId: id(2),
      trigger: "COMPLETED",
      status: "DRAFT",
      revision: 1,
      effectiveFrom: "2026-08-10T00:00:00.000Z",
      evidenceReference: null,
      confirmedAt: null,
      activatedAt: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      createdBy: { displayName: "Development administrator" },
      confirmedBy: null,
      activatedBy: null,
      createdById: id(9),
    });
    expect(parsed).not.toHaveProperty("createdById");
  });
});
