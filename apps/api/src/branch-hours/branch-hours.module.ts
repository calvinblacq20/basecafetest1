import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BranchHoursController } from "./branch-hours.controller.js";
import { BranchHoursService } from "./branch-hours.service.js";

@Module({
  imports: [AuthModule],
  controllers: [BranchHoursController],
  providers: [BranchHoursService],
  exports: [BranchHoursService],
})
export class BranchHoursModule {}
