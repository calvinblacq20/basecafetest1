import { describe, expect, it } from "vitest";

import { availabilityIssue } from "../src/catalog/availability.js";

describe("catalog availability", () => {
  it("requires a reason when an entry is unavailable", () => {
    expect(availabilityIssue({ isAvailable: false })).toBe(
      "An unavailable catalog entry requires a reason.",
    );
  });

  it("rejects a window whose end is not after its start", () => {
    expect(
      availabilityIssue({
        isAvailable: false,
        unavailableReason: "Sold out",
        unavailableFrom: "2026-08-06T12:00:00.000Z",
        unavailableTo: "2026-08-06T11:59:59.000Z",
      }),
    ).toBe("The unavailable end must be after the start.");
  });

  it("accepts a reasoned, bounded unavailable window", () => {
    expect(
      availabilityIssue({
        isAvailable: false,
        unavailableReason: "Demo stock unavailable",
        unavailableFrom: "2026-08-06T12:00:00.000Z",
        unavailableTo: "2026-08-06T13:00:00.000Z",
      }),
    ).toBeNull();
  });
});
