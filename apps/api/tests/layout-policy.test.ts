import { describe, expect, it } from "vitest";

import {
  diningAreaDeactivationIssue,
  diningTableActivationIssue,
} from "../src/layout/layout-policy.js";

describe("dining layout lifecycle policy", () => {
  it("blocks area deactivation while active tables remain", () => {
    expect(diningAreaDeactivationIssue(1)).toBe("ACTIVE_TABLES");
    expect(diningAreaDeactivationIssue(0)).toBeNull();
  });

  it("requires an inactive table and active parent area for activation", () => {
    expect(diningTableActivationIssue(true, true)).toBe("ALREADY_ACTIVE");
    expect(diningTableActivationIssue(false, false)).toBe("AREA_INACTIVE");
    expect(diningTableActivationIssue(false, true)).toBeNull();
  });
});
