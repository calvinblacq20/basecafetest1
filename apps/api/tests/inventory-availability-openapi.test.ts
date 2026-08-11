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
      .setTitle("Inventory availability")
      .setVersion("1")
      .build(),
  ).paths;
});
afterAll(async () => app.close());

describe("inventory availability OpenAPI", () => {
  it.each([
    "/inventory-availability/branches/{branchId}/rules",
    "/inventory-availability/branches/{branchId}/manual-history",
    "/inventory-availability/preview",
    "/inventory-availability/rules",
    "/inventory-availability/rules/{ruleId}/confirm",
    "/inventory-availability/rules/{ruleId}/activate",
    "/inventory-availability/rules/{ruleId}/cancel",
    "/inventory-availability/manual-events",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
