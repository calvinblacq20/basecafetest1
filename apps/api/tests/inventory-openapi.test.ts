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
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("Inventory smoke").setVersion("1").build(),
  );
  paths = document.paths;
});

afterAll(async () => app.close());

describe("inventory OpenAPI", () => {
  it.each([
    "/inventory/branches/{branchId}/balances",
    "/inventory/branches/{branchId}/ledger",
    "/inventory/branches/{branchId}/transfers",
    "/inventory/branches/{branchId}/counts",
    "/inventory/recipes",
    "/inventory/adjustments",
    "/inventory/transfers",
    "/inventory/counts/{countId}/post",
    "/inventory/consumption-preview",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
