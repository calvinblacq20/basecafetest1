import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let paths: Record<string, unknown>;
beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  paths = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("Offline sync").setVersion("1").build(),
  ).paths;
});
afterAll(async () => app.close());

describe("offline sync OpenAPI", () => {
  it("documents the protected batch endpoint", () => {
    expect(paths).toHaveProperty("/sync/batch.post");
    expect(paths).toHaveProperty("/sync/bootstrap/{branchId}.get");
    expect(paths).toHaveProperty("/sync/recovery/{branchId}.get");
    expect(paths).toHaveProperty("/sync/commands/{commandId}/resolve.post");
    expect(paths).toHaveProperty("/operations/evidence.get");
    expect(paths).toHaveProperty("/operations/evidence.post");
    expect(paths).toHaveProperty("/operations/diagnostics.get");
    expect(paths).toHaveProperty("/health/live.get");
    expect(paths).toHaveProperty("/health/ready.get");
  });
});
