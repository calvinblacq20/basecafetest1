import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Check API process liveness without dependencies" })
  @ApiOkResponse({ description: "API process is live" })
  live() {
    return this.healthService.live();
  }

  @Get("ready")
  @ApiOperation({ summary: "Check database readiness and outbox backlog" })
  @ApiOkResponse({ description: "API database dependency is ready" })
  async ready() {
    const health = await this.healthService.ready();
    if (health.status === "degraded") {
      throw new ServiceUnavailableException(health);
    }
    return health;
  }

  @Get()
  @ApiOperation({ summary: "Compatibility alias for database readiness" })
  @ApiOkResponse({ description: "API and database are ready" })
  async check() {
    const health = await this.healthService.ready();
    if (health.status === "degraded") {
      throw new ServiceUnavailableException(health);
    }
    return health;
  }
}
