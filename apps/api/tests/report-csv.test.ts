import { describe, expect, it } from "vitest";
import { renderCsv } from "../src/reports/report-csv.js";

describe("report CSV", () => {
  it("uses stable RFC-4180 escaping and CRLF endings", () => {
    expect(
      renderCsv(
        ["name", "amount_minor"],
        [{ name: 'Jollof, "large"\nmeal', amount_minor: 2500 }],
      ),
    ).toBe('name,amount_minor\r\n"Jollof, ""large""\nmeal",2500\r\n');
  });
});
