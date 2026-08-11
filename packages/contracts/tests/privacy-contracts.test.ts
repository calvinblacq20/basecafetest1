import { describe, expect, it } from "vitest";

import {
  createCustomerRequestSchema,
  customerSearchQuerySchema,
  transitionPrivacyRequestSchema,
} from "../src/privacy.js";

describe("privacy contracts", () => {
  it("requires a customer identity and an exact search key", () => {
    expect(
      createCustomerRequestSchema.safeParse({
        customerId: "00000000-0000-4000-8000-000000000001",
        reason: "Create an operational profile.",
      }).success,
    ).toBe(false);
    expect(customerSearchQuerySchema.safeParse({}).success).toBe(false);
    expect(
      customerSearchQuerySchema.parse({ email: "AMA@example.com" }),
    ).toEqual({
      email: "AMA@example.com",
      limit: 20,
    });
  });

  it("requires positive revisions on request transitions", () => {
    expect(
      transitionPrivacyRequestSchema.safeParse({
        revision: 0,
        status: "IN_PROGRESS",
        reason: "Identity checked.",
      }).success,
    ).toBe(false);
  });
});
