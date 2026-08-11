import type { LivenessResponse, ReadinessResponse } from "@base-cafe/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  live(): LivenessResponse {
    return {
      status: "ok",
      service: "base-cafe-api",
      version: process.env.APP_VERSION ?? "0.1.0",
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<ReadinessResponse> {
    let database: ReadinessResponse["database"] = "up";
    let unpublishedCount = 0;
    let oldestUnpublishedAt: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const outbox = await this.prisma.outboxEvent.aggregate({
        where: { publishedAt: null },
        _count: { _all: true },
        _min: { occurredAt: true },
      });
      unpublishedCount = outbox._count._all;
      oldestUnpublishedAt = outbox._min.occurredAt?.toISOString() ?? null;
    } catch {
      database = "down";
    }

    return {
      status: database === "up" ? "ok" : "degraded",
      service: "base-cafe-api",
      version: process.env.APP_VERSION ?? "0.1.0",
      timestamp: new Date().toISOString(),
      database,
      outbox: { unpublishedCount, oldestUnpublishedAt },
    };
  }

  check(): Promise<ReadinessResponse> {
    return this.ready();
  }
}
