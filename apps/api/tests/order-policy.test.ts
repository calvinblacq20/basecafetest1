import { describe, expect, it } from "vitest";

import {
  assignFreeSelections,
  customerDataVisible,
  officialOrderNumber,
  orderTransitionAllowed,
} from "../src/orders/order-policy.js";

describe("order policy", () => {
  it("formats immutable business-date sequence numbers", () => {
    expect(officialOrderNumber(new Date("2026-08-06T00:00:00Z"), 1)).toBe(
      "20260806-0001",
    );
    expect(officialOrderNumber(new Date("2026-12-31T00:00:00Z"), 42)).toBe(
      "20261231-0042",
    );
  });

  it("allows only open-held and active-cancelled transitions", () => {
    expect(orderTransitionAllowed("OPEN", "HELD")).toBe(true);
    expect(orderTransitionAllowed("HELD", "OPEN")).toBe(true);
    expect(orderTransitionAllowed("OPEN", "CANCELLED")).toBe(true);
    expect(orderTransitionAllowed("CANCELLED", "OPEN")).toBe(false);
  });

  it("assigns equal-price free selections deterministically", () => {
    const result = assignFreeSelections(
      [
        { id: "b", deltaMinor: 200, quantity: 1 },
        { id: "a", deltaMinor: 200, quantity: 2 },
      ],
      2,
    );
    expect(result.issue).toBeUndefined();
    expect(result.selections).toEqual([
      expect.objectContaining({ id: "b", chargedDeltaMinor: 200 }),
      expect.objectContaining({ id: "a", chargedDeltaMinor: 0 }),
    ]);
  });

  it("blocks ambiguous mixed-price free selections", () => {
    expect(
      assignFreeSelections(
        [
          { id: "a", deltaMinor: 100, quantity: 1 },
          { id: "b", deltaMinor: 200, quantity: 1 },
        ],
        1,
      ).issue,
    ).toBe("MODIFIER_FREE_SELECTION_POLICY_UNCONFIRMED");
  });

  it("masks delivery fields without customer-data permission", () => {
    const order = {
      customerPhone: "0200000000",
      deliveryDirections: "Behind the gate",
      customerReference: "Caller",
    };
    expect(customerDataVisible(order, false)).toEqual({
      ...order,
      customerPhone: null,
      deliveryDirections: null,
    });
    expect(customerDataVisible(order, true)).toBe(order);
  });
});
