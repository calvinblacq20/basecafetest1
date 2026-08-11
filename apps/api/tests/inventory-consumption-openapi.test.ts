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
      .setTitle("Inventory consumption")
      .setVersion("1")
      .build(),
  ).paths;
});
afterAll(async () => app.close());

describe("inventory consumption OpenAPI", () => {
  it.each([
    "/inventory-consumption/branches/{branchId}/policies",
    "/inventory-consumption/policies/{policyId}/confirm",
    "/inventory-consumption/routes/{routeId}/activate",
    "/inventory-consumption/preview",
    "/inventory-consumption/{consumptionId}/reverse",
    "/inventory-consumption/branches/{branchId}/reconciliation",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
