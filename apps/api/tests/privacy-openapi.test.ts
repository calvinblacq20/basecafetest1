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
    new DocumentBuilder().setTitle("Privacy").setVersion("1").build(),
  ).paths;
});
afterAll(async () => app.close());

describe("privacy OpenAPI", () => {
  it.each([
    "/customers",
    "/customers/search",
    "/customers/{customerId}",
    "/customers/{customerId}/export",
    "/customers/{customerId}/consents",
    "/customers/{customerId}/privacy-requests",
    "/privacy-requests",
    "/privacy-requests/{requestId}/transition",
    "/privacy/retention-policies",
    "/privacy/retention-policies/{policyId}/activate",
    "/privacy/retention-preview",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
