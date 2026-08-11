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
    new DocumentBuilder().setTitle("Procurement").setVersion("1").build(),
  ).paths;
});
afterAll(async () => app.close());

describe("procurement OpenAPI", () => {
  it.each([
    "/procurement/branches/{branchId}/suppliers",
    "/procurement/branches/{branchId}/purchase-orders",
    "/procurement/branches/{branchId}/goods-receipts",
    "/procurement/branches/{branchId}/purchase-returns",
    "/procurement/suppliers",
    "/procurement/supplier-items",
    "/procurement/purchase-orders",
    "/procurement/purchase-orders/{orderId}/submit",
    "/procurement/purchase-orders/{orderId}/cancel",
    "/procurement/purchase-orders/{orderId}/receipts",
    "/procurement/goods-receipts/{receiptId}/returns",
    "/procurement/branches/{branchId}/valuation-preview",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
