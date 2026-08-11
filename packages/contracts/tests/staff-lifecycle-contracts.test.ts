import { describe, expect, it } from "vitest";

import {
  reactivateStaffRequestSchema,
  removeStaffRoleRequestSchema,
} from "../src/administration.js";

const branchId = "10000000-0000-4000-8000-000000000002";

describe("staff lifecycle contracts", () => {
  it("requires optimistic revision and an audit reason", () => {
    for (const schema of [
      reactivateStaffRequestSchema,
      removeStaffRoleRequestSchema,
    ]) {
      expect(
        schema.safeParse({ branchId, revision: 4, reason: "Owner approved" })
          .success,
      ).toBe(true);
      expect(
        schema.safeParse({ branchId, revision: 0, reason: "" }).success,
      ).toBe(false);
    }
  });
});
