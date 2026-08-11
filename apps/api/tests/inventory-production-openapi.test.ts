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
      .setTitle("Inventory production")
      .setVersion("1")
      .build(),
  ).paths;
});
afterAll(async () => app.close());

describe("inventory production OpenAPI", () => {
  it.each([
    "/inventory-production/branches/{branchId}/modifier-effects",
    "/inventory-production/modifier-effects/{effectId}/activate",
    "/inventory-production/branches/{branchId}/batch-recipes",
    "/inventory-production/branches/{branchId}/batches",
    "/inventory-production/batch-recipes/{recipeId}/activate",
    "/inventory-production/batches/preview",
    "/inventory-production/batches",
    "/inventory-production/batches/{productionId}/reverse",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
