import { describe, expect, it } from "vitest";

import {
  MENU_IMPORT_HEADERS,
  menuImportValidationHash,
  parseGhsMinor,
  parseMenuImportCsv,
} from "../src/catalog/menu-import-parser.js";

const validRow = [
  "UPSERT",
  "MAIN",
  "DEFAULT",
  "FOOD",
  "Food",
  "ITEM-001",
  "Demo item",
  "Fictional test item",
  "",
  "",
  "12.50",
  "STANDARD",
  "KITCHEN",
  "",
  "FALSE",
  "",
  "",
  "FALSE",
  "10",
  "TRUE",
  "",
];

function csv(row = validRow): string {
  return `${MENU_IMPORT_HEADERS.join(",")}\n${row.join(",")}`;
}

describe("menu CSV parser", () => {
  it("parses exact pesewa amounts without floating point arithmetic", () => {
    expect(parseGhsMinor("12.50")).toBe(1_250);
    expect(parseGhsMinor("0.00")).toBe(0);
    expect(parseGhsMinor("12.345")).toBeNull();
  });

  it("accepts a complete base item row", () => {
    const result = parseMenuImportCsv(csv(), {
      branchCode: "MAIN",
      menuCode: "DEFAULT",
    });
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      itemCode: "ITEM-001",
      priceMinor: 1_250,
      active: true,
    });
  });

  it("rejects the supplied example and spreadsheet formulas", () => {
    const row = [...validRow];
    row[0] = "EXAMPLE_DO_NOT_IMPORT";
    row[6] = "=1+1";
    const result = parseMenuImportCsv(csv(row), {
      branchCode: "MAIN",
      menuCode: "DEFAULT",
    });
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["EXAMPLE_ROW", "FORMULA_INJECTION_RISK"]),
    );
  });

  it("handles quoted commas and rejects malformed quotes", () => {
    const row = [...validRow];
    row[7] = '"Fictional, quoted description"';
    expect(
      parseMenuImportCsv(csv(row), {
        branchCode: "MAIN",
        menuCode: "DEFAULT",
      }).rows[0]?.description,
    ).toBe("Fictional, quoted description");
    expect(
      parseMenuImportCsv(`${MENU_IMPORT_HEADERS.join(",")}\n"unfinished`, {
        branchCode: "MAIN",
        menuCode: "DEFAULT",
      }).issues[0]?.code,
    ).toBe("MALFORMED_CSV");
  });

  it("binds validation to source and target namespace", () => {
    const first = menuImportValidationHash(
      "a".repeat(64),
      "branch-1",
      "MAIN",
      "DEFAULT",
    );
    const second = menuImportValidationHash(
      "a".repeat(64),
      "branch-2",
      "MAIN",
      "DEFAULT",
    );
    expect(first).not.toBe(second);
  });
});
