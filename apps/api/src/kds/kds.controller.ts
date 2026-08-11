import {
  idempotencyKeySchema,
  identifierSchema,
  preparationTicketQuerySchema,
  transitionPreparationTicketRequestSchema,
  type PreparationTicketQuery,
  type TransitionPreparationTicketRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { KdsService } from "./kds.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("kitchen display")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("kds")
export class KdsController {
  constructor(@Inject(KdsService) private readonly kds: KdsService) {}

  @Get("branches/:branchId/stations")
  @RequirePermissions("kds.read")
  @ApiOperation({ summary: "List active preparation stations for a KDS" })
  stations(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.stations(branchId, request.user);
  }

  @Get("branches/:branchId/tickets")
  @RequirePermissions("kds.read")
  @ApiOperation({ summary: "List a bounded station preparation queue" })
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(preparationTicketQuerySchema))
    query: PreparationTicketQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.list(branchId, query, request.user);
  }

  @Get("branches/:branchId/tickets/:ticketId")
  @RequirePermissions("kds.read")
  get(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("ticketId", new ZodValidationPipe(identifierSchema))
    ticketId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.get(ticketId, branchId, request.user);
  }

  @Post("tickets/:ticketId/preparing")
  @RequirePermissions("kds.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  preparing(
    @Param("ticketId", new ZodValidationPipe(identifierSchema))
    ticketId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transitionPreparationTicketRequestSchema))
    input: TransitionPreparationTicketRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.preparing(ticketId, input, key(value), request.user);
  }

  @Post("tickets/:ticketId/ready")
  @RequirePermissions("kds.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  ready(
    @Param("ticketId", new ZodValidationPipe(identifierSchema))
    ticketId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transitionPreparationTicketRequestSchema))
    input: TransitionPreparationTicketRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.ready(ticketId, input, key(value), request.user);
  }

  @Post("tickets/:ticketId/complete")
  @RequirePermissions("kds.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  complete(
    @Param("ticketId", new ZodValidationPipe(identifierSchema))
    ticketId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transitionPreparationTicketRequestSchema))
    input: TransitionPreparationTicketRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.kds.complete(ticketId, input, key(value), request.user);
  }
}
