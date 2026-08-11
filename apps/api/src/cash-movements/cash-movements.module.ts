import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CashMovementsController } from "./cash-movements.controller.js";
import { CashMovementsService } from "./cash-movements.service.js";

@Module({
  imports: [AuthModule],
  controllers: [CashMovementsController],
  providers: [CashMovementsService],
})
export class CashMovementsModule {}
