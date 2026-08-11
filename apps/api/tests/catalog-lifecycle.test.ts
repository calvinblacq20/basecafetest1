import { describe, expect, it } from "vitest";

import { itemActivationIssues } from "../src/catalog/catalog-lifecycle.js";

describe("catalog lifecycle", () => {
  it("reports every missing activation requirement", () => {
    expect(
      itemActivationIssues({
        stationConfigured: false,
        taxClassActive: false,
        effectivePrice: false,
      }),
    ).toHaveLength(3);
  });

  it("accepts a fully configured item", () => {
    expect(
      itemActivationIssues({
        stationConfigured: true,
        taxClassActive: true,
        effectivePrice: true,
      }),
    ).toEqual([]);
  });
});
