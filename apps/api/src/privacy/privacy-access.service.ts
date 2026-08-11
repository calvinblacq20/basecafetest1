import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PrivacyAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  record(
    principal: AuthPrincipal,
    input: Readonly<{
      accessType: "VIEW" | "SEARCH" | "EXPORT" | "ORDER_VIEW";
      resourceType: string;
      resourceId: string;
      customerId?: string | null;
      fields: readonly string[];
      reason: string;
    }>,
    client: DatabaseClient = this.prisma,
  ) {
    return client.customerDataAccessEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorId: principal.userId,
        customerId: input.customerId ?? null,
        accessType: input.accessType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        fields: [...input.fields],
        reason: input.reason,
      },
    });
  }
}
