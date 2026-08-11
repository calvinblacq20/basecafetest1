import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger as PinoLogger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import {
  corsAllowedHeaders,
  corsAllowedOrigins,
  corsExposedHeaders,
} from "./common/cors-policy.js";
import {
  assertRuntimeEnvironment,
  runtimePosture,
} from "./common/runtime-environment.js";

async function bootstrap() {
  assertRuntimeEnvironment(process.env);
  Logger.log(JSON.stringify(runtimePosture(process.env)), "RuntimePosture");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.use(helmet());
  const corsOrigins = corsAllowedOrigins(process.env);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowedHeaders: [...corsAllowedHeaders],
      exposedHeaders: [...corsExposedHeaders],
      credentials: false,
      maxAge: 600,
    });
  }
  const configuredProxyHops = Number.parseInt(
    process.env.TRUST_PROXY_HOPS ?? "0",
    10,
  );
  if (Number.isInteger(configuredProxyHops) && configuredProxyHops > 0) {
    const express = app.getHttpAdapter().getInstance() as {
      set(name: string, value: number): void;
    };
    express.set("trust proxy", Math.min(configuredProxyHops, 10));
  }
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Base Cafe POS API")
    .setDescription(
      "Auditable REST API for the Base Cafe POS. Demo configuration is not production business data.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .addApiKey(
      { type: "apiKey", in: "header", name: "Idempotency-Key" },
      "idempotency-key",
    )
    .build();
  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = Number.parseInt(process.env.PORT ?? "3100", 10);
  await app.listen(port, "0.0.0.0");
  Logger.log(
    `Base Cafe API listening on http://localhost:${port}`,
    "Bootstrap",
  );
}

void bootstrap();
