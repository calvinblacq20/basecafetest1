import { describe, expect, it } from "vitest";

import {
  routePreparationEntries,
  ticketTransitionAllowed,
} from "../src/kds/kds-policy.js";

describe("preparation routing and lifecycle", () => {
  it("routes an item locally and a station-specific modifier separately", () => {
    const result = routePreparationEntries([
      {
        id: "line-1",
        quantity: 2,
        itemNameSnapshot: "Combo",
        variantNameSnapshot: null,
        note: "No onions",
        stationId: "kitchen",
        stationNameSnapshot: "Kitchen",
        modifiers: [
          {
            id: "local",
            quantity: 1,
            modifierNameSnapshot: "Extra sauce",
            modifierGroupNameSnapshot: "Sauce",
            stationId: null,
            stationNameSnapshot: null,
          },
          {
            id: "bar-addon",
            quantity: 1,
            modifierNameSnapshot: "Add drink",
            modifierGroupNameSnapshot: "Drink",
            stationId: "bar",
            stationNameSnapshot: "Bar",
          },
        ],
      },
    ]);
    expect(result.issue).toBeUndefined();
    expect(result.stations?.get("kitchen")?.entries).toEqual([
      expect.objectContaining({
        kind: "ITEM",
        quantity: 2,
        modifierSummary: [{ name: "Extra sauce", group: "Sauce", quantity: 1 }],
      }),
    ]);
    expect(result.stations?.get("bar")?.entries).toEqual([
      expect.objectContaining({
        kind: "MODIFIER",
        quantity: 2,
        orderLineModifierId: "bar-addon",
      }),
    ]);
  });

  it("rejects missing station snapshots", () => {
    expect(
      routePreparationEntries([
        {
          id: "line-1",
          quantity: 1,
          itemNameSnapshot: "Unrouted",
          variantNameSnapshot: null,
          note: null,
          stationId: null,
          stationNameSnapshot: null,
          modifiers: [],
        },
      ]).issue,
    ).toBe("PREPARATION_STATION_MISSING");
  });

  it("enforces queued-preparing-ready-completed ordering", () => {
    expect(ticketTransitionAllowed("QUEUED", "PREPARING")).toBe(true);
    expect(ticketTransitionAllowed("PREPARING", "READY")).toBe(true);
    expect(ticketTransitionAllowed("READY", "COMPLETED")).toBe(true);
    expect(ticketTransitionAllowed("QUEUED", "READY")).toBe(false);
    expect(ticketTransitionAllowed("COMPLETED", "READY")).toBe(false);
  });
});
