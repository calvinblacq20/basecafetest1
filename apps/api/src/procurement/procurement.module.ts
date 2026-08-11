import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ProcurementController } from "./procurement.controller.js";
import { ProcurementService } from "./procurement.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
})
export class ProcurementModule {}
