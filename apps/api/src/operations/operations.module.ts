import { Module } from "@nestjs/common";

import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";
import { PilotReadinessService } from "./pilot-readiness.service.js";

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, PilotReadinessService],
  exports: [OperationsService, PilotReadinessService],
})
export class OperationsModule {}
