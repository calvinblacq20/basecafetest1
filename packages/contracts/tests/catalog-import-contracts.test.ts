import { describe, expect, it } from "vitest";

import {
  menuImportApplyRequestSchema,
  menuImportDryRunResponseSchema,
  menuImportDryRunRequestSchema,
  menuImportV1Headers,
} from "../src/catalog-import.js";

const base = {
  branchId: "10000000-0000-4000-8000-000000000002",
  branchCode: "main",
  menuCode: "default",
  schemaVersion: "menu-v1" as const,
  fileName: "menu.csv",
  csvText: "row_action\nUPSERT",
};

describe("catalog import contracts", () => {
  it("normalizes import namespace codes", () => {
    const result = menuImportDryRunRequestSchema.parse(base);
    expect(result.branchCode).toBe("MAIN");
    expect(result.menuCode).toBe("DEFAULT");
  });

  it("rejects path-like names and invalid validation hashes", () => {
    expect(
      menuImportDryRunRequestSchema.safeParse({
        ...base,
        fileName: "../menu.csv",
      }).success,
    ).toBe(false);
    expect(
      menuImportApplyRequestSchema.safeParse({
        ...base,
        validationHash: "not-a-hash",
        reason: "Approved import",
      }).success,
    ).toBe(false);
  });

  it("publishes the exact menu-v1 template and detailed dry-run response", () => {
    expect(menuImportV1Headers).toHaveLength(21);
    expect(menuImportV1Headers[0]).toBe("row_action");
    expect(menuImportV1Headers.at(-1)).toBe("notes");
    expect(
      menuImportDryRunResponseSchema.parse({
        schemaVersion: "menu-v1",
        fileName: "menu.csv",
        sourceHash: "a".repeat(64),
        validationHash: "b".repeat(64),
        valid: false,
        summary: {
          dataRows: 1,
          categories: 0,
          items: 0,
          variants: 0,
          prices: 0,
          errors: 1,
          warnings: 0,
        },
        issues: [
          {
            row: 2,
            field: "item_code",
            severity: "ERROR",
            code: "REQUIRED",
            message: "Item code is required.",
          },
        ],
      }).issues,
    ).toHaveLength(1);
  });
});
