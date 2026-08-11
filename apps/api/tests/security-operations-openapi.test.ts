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
    new DocumentBuilder()
      .setTitle("Security operations")
      .setVersion("1")
      .build(),
  ).paths;
});
afterAll(async () => app.close());

describe("security operations OpenAPI", () => {
  it.each([
    "/security/alerts",
    "/security/monitoring/evaluate",
    "/security/alerts/{alertId}/acknowledge",
    "/security/alerts/{alertId}/resolve",
    "/security/sessions",
    "/security/sessions/{sessionId}/revoke",
    "/security/privacy/key-posture",
    "/security/privacy/key-rotation/rewrap",
    "/security/privacy/legacy-migration-preview",
    "/audit/export.csv",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
