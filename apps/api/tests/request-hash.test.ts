import { describe, expect, it } from "vitest";

import { requestHash } from "../src/common/request-hash.js";

describe("requestHash", () => {
  it("is stable when object keys arrive in a different order", () => {
    expect(requestHash({ branchId: "a", name: "Drinks", sortOrder: 1 })).toBe(
      requestHash({ sortOrder: 1, name: "Drinks", branchId: "a" }),
    );
  });

  it("changes when the command payload changes", () => {
    expect(requestHash({ name: "Drinks" })).not.toBe(
      requestHash({ name: "Food" }),
    );
  });
});
