import { describe, expect, it } from "vitest";

import {
  corsAllowedHeaders,
  corsAllowedOrigins,
  corsExposedHeaders,
} from "../src/common/cors-policy.js";

describe("CORS policy", () => {
  it("uses local application origins only outside production", () => {
    expect(corsAllowedOrigins({ NODE_ENV: "development" })).toContain(
      "http://localhost:3000",
    );
    expect(corsAllowedOrigins({ NODE_ENV: "production" })).toEqual([]);
  });

  it("normalizes, de-duplicates and sorts configured origins", () => {
    expect(
      corsAllowedOrigins({
        NODE_ENV: "production",
        CORS_ALLOWED_ORIGINS:
          "https://pos.example.test,http://localhost:3010/,https://pos.example.test",
      }),
    ).toEqual(["http://localhost:3010", "https://pos.example.test"]);
  });

  it("rejects paths and non-HTTP schemes", () => {
    expect(() =>
      corsAllowedOrigins({ CORS_ALLOWED_ORIGINS: "https://example.test/pos" }),
    ).toThrow(/without paths/i);
    expect(() =>
      corsAllowedOrigins({ CORS_ALLOWED_ORIGINS: "file:///tmp/pos" }),
    ).toThrow(/HTTP\(S\)/);
  });

  it("exposes deterministic download filenames to browser clients", () => {
    expect(corsExposedHeaders).toContain("Content-Disposition");
    expect(corsAllowedHeaders).toContain("X-Customer-Data-Reason");
  });
});
