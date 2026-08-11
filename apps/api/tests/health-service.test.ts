import { describe, expect, it, vi } from "vitest";

import { HealthService } from "../src/health/health.service.js";

describe("HealthService", () => {
  it("keeps liveness dependency-free", () => {
    const service = new HealthService({} as never);
    expect(service.live()).toMatchObject({
      status: "ok",
      service: "base-cafe-api",
    });
  });

  it("returns database readiness and a safe outbox backlog", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
      outboxEvent: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 4 },
          _min: { occurredAt: new Date("2026-08-08T01:00:00.000Z") },
        }),
      },
    };
    const service = new HealthService(prisma as never);
    await expect(service.ready()).resolves.toMatchObject({
      status: "ok",
      database: "up",
      outbox: {
        unpublishedCount: 4,
        oldestUnpublishedAt: "2026-08-08T01:00:00.000Z",
      },
    });
  });

  it("reports a database outage without leaking the database error", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockRejectedValue(new Error("secret connection string")),
      outboxEvent: { aggregate: vi.fn() },
    };
    const service = new HealthService(prisma as never);
    const result = await service.ready();
    expect(result).toMatchObject({ status: "degraded", database: "down" });
    expect(JSON.stringify(result)).not.toContain("secret connection string");
  });
});
