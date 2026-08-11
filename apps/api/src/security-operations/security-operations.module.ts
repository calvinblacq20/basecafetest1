import { Module } from "@nestjs/common";

import { PrivacyModule } from "../privacy/privacy.module.js";
import { SecurityOperationsController } from "./security-operations.controller.js";
import { SecurityOperationsService } from "./security-operations.service.js";

@Module({
  imports: [PrivacyModule],
  controllers: [SecurityOperationsController],
  providers: [SecurityOperationsService],
  exports: [SecurityOperationsService],
})
export class SecurityOperationsModule {}
