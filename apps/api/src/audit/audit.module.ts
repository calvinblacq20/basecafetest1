import { Global, Module } from "@nestjs/common";

import { AuditController } from "./audit.controller.js";
import { AuditIntegrityService } from "./audit-integrity.service.js";
import { AuditService } from "./audit.service.js";

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditIntegrityService],
  exports: [AuditService, AuditIntegrityService],
})
export class AuditModule {}
