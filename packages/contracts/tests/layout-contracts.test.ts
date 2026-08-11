import { describe, expect, it } from "vitest";

import {
  createDiningTableRequestSchema,
  diningAreaListResponseSchema,
  updateDiningAreaRequestSchema,
  updateDiningTableRequestSchema,
} from "../src/layout.js";

const branchId = "10000000-0000-4000-8000-000000000002";
const diningAreaId = "10000000-0000-4000-8000-000000000020";

describe("layout contracts", () => {
  it("normalizes stable keys and accepts an unconfirmed combinable-group label", () => {
    const parsed = createDiningTableRequestSchema.parse({
      branchId,
      diningAreaId,
      externalKey: "main-t01",
      name: "Example table",
      capacity: 4,
      combinableGroup: "window-pair",
      reason: "Example configuration only",
    });
    expect(parsed.externalKey).toBe("MAIN-T01");
    expect(parsed.combinableGroup).toBe("WINDOW-PAIR");
  });

  it("rejects empty updates and invalid capacity or coordinates", () => {
    expect(
      updateDiningAreaRequestSchema.safeParse({
        branchId,
        revision: 1,
        reason: "No actual change",
      }).success,
    ).toBe(false);
    expect(
      updateDiningTableRequestSchema.safeParse({
        branchId,
        revision: 1,
        reason: "Invalid example",
        capacity: 0,
        positionX: -1,
      }).success,
    ).toBe(false);
  });

  it("parses nested revision-aware layout projections", () => {
    const now = "2026-08-09T12:00:00.000Z";
    expect(
      diningAreaListResponseSchema.parse([
        {
          id: diningAreaId,
          branchId,
          externalKey: "DEMO_AREA",
          name: "Fictional area",
          displayOrder: 0,
          isActive: true,
          revision: 2,
          createdAt: now,
          updatedAt: now,
          tables: [
            {
              id: "10000000-0000-4000-8000-000000000021",
              branchId,
              diningAreaId,
              externalKey: "DEMO_TABLE",
              name: "Fictional table",
              capacity: 4,
              combinableGroup: null,
              displayOrder: 0,
              positionX: null,
              positionY: null,
              isActive: true,
              revision: 2,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      ])[0]?.tables,
    ).toHaveLength(1);
  });
});
