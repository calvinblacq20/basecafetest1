import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { LayoutController } from "./layout.controller.js";
import { LayoutService } from "./layout.service.js";

@Module({
  imports: [AuthModule],
  controllers: [LayoutController],
  providers: [LayoutService],
})
export class LayoutModule {}
