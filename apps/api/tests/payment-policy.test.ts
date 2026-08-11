import { describe, expect, it } from "vitest";

import {
  initialPaymentState,
  outstandingMinor,
  verifiedPaymentState,
} from "../src/payments/payment-policy.js";

describe("payment policy", () => {
  it("confirms cash immediately and computes change in integer minor units", () => {
    expect(initialPaymentState("CASH", 1_250, 2_000)).toMatchObject({
      status: "CONFIRMED",
      changeMinor: 750,
    });
  });

  it("holds external methods for verification", () => {
    expect(initialPaymentState("MANUAL_MOMO", 1_250)).toMatchObject({
      status: "REQUIRES_VERIFICATION",
      changeMinor: 0,
      confirmedAt: null,
    });
  });

  it("rejects insufficient cash and never returns a negative balance", () => {
    expect(() => initialPaymentState("CASH", 1_250, 1_249)).toThrow(
      "CASH_TENDER_INVALID",
    );
    expect(outstandingMinor(1_250, 1_500)).toBe(0);
  });

  it("maps verification decisions to terminal states", () => {
    expect(verifiedPaymentState("CONFIRM").status).toBe("CONFIRMED");
    expect(verifiedPaymentState("FAIL").status).toBe("FAILED");
  });
});
