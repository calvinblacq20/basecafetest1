import { describe, expect, it } from "vitest";

import {
  catalogRevisionCommandSchema,
  deactivateCatalogRequestSchema,
  updateMenuItemRequestSchema,
} from "../src/index.js";

const branchId = "10000000-0000-4000-8000-000000000002";

describe("catalog lifecycle contracts", () => {
  it("requires a positive revision and an update field", () => {
    expect(
      catalogRevisionCommandSchema.safeParse({ branchId, revision: 0 }).success,
    ).toBe(false);
    expect(
      updateMenuItemRequestSchema.safeParse({ branchId, revision: 1 }).success,
    ).toBe(false);
  });

  it("requires a reason for activation commands", () => {
    expect(
      catalogRevisionCommandSchema.safeParse({ branchId, revision: 1 }).success,
    ).toBe(false);
    expect(
      catalogRevisionCommandSchema.safeParse({
        branchId,
        revision: 1,
        reason: "Activate after configuration review.",
      }).success,
    ).toBe(true);
  });

  it("requires an audited deactivation reason", () => {
    expect(
      deactivateCatalogRequestSchema.safeParse({
        branchId,
        revision: 1,
        reason: " ",
      }).success,
    ).toBe(false);
  });
});
