import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ReceiptsController } from "./receipts.controller.js";
import { ReceiptsService } from "./receipts.service.js";
@Module({
  imports: [AuthModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
