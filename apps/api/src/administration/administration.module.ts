import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AdministrationController } from "./administration.controller.js";
import { AdministrationService } from "./administration.service.js";

@Module({
  imports: [AuthModule],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
