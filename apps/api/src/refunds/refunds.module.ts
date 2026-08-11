import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RefundsController } from "./refunds.controller.js";
import { RefundsService } from "./refunds.service.js";
@Module({
  imports: [AuthModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
