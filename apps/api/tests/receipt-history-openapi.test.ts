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
    new DocumentBuilder().setTitle("Receipt history").setVersion("1").build(),
  ).paths;
});

afterAll(async () => app.close());

describe("receipt history OpenAPI", () => {
  it.each([
    "/receipts/branches/{branchId}",
    "/receipts/{receiptId}",
    "/receipts/{receiptId}/render",
    "/receipts/{receiptId}/reprint",
    "/print-jobs/{printJobId}/retry",
    "/sync/recovery/{branchId}",
    "/sync/commands/{commandId}/resolve",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
