import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BranchHoursModule } from "../branch-hours/branch-hours.module.js";
import { ShiftsController } from "./shifts.controller.js";
import { ShiftsService } from "./shifts.service.js";

@Module({
  imports: [AuthModule, BranchHoursModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
