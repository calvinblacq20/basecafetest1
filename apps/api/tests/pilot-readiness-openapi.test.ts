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
    new DocumentBuilder().setTitle("Pilot readiness").setVersion("1").build(),
  ).paths;
});
afterAll(async () => app.close());

describe("pilot readiness OpenAPI", () => {
  it.each([
    "/operations/pilot-readiness",
    "/operations/pilot-readiness/evidence",
    "/operations/pilot-readiness/reviews",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
