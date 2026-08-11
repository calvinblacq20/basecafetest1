import type {
  CategoryResponse,
  CreateCategoryRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Category } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";

const CREATE_CATEGORY_SCOPE = "catalog.category.create";

function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    branchId: category.branchId,
    externalKey: category.externalKey,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCategories(
    branchId: string,
    principal: AuthPrincipal,
  ): Promise<CategoryResponse[]> {
    this.assertBranchPermission(principal, "catalog.read", branchId);
    await this.assertBranchInOrganization(branchId, principal.organizationId);
    const categories = await this.prisma.category.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return categories.map(toCategoryResponse);
  }

  async createCategory(
    input: CreateCategoryRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ): Promise<CategoryResponse> {
    this.assertBranchPermission(principal, "catalog.write", input.branchId);
    const hash = requestHash(input);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope: CREATE_CATEGORY_SCOPE,
          key: idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== hash) {
        throw new ConflictException(
          "The idempotency key was already used with a different request.",
        );
      }
      return existing.responseBody as CategoryResponse;
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const branch = await transaction.branch.findFirst({
            where: {
              id: input.branchId,
              organizationId: principal.organizationId,
            },
          });
          if (!branch) {
            throw new NotFoundException("Branch not found.");
          }

          const category = await transaction.category.create({
            data: {
              branchId: input.branchId,
              externalKey: input.externalKey ?? null,
              name: input.name,
              description: input.description ?? null,
              sortOrder: input.sortOrder,
            },
          });
          const response = toCategoryResponse(category);

          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: input.branchId,
              actorId: principal.userId,
              action: CREATE_CATEGORY_SCOPE,
              entityType: "category",
              entityId: category.id,
              reason: input.reason,
              metadata: {
                deviceId: principal.deviceId,
                categoryName: category.name,
              },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "category",
              aggregateId: category.id,
              eventType: "catalog.category.created",
              payload: {
                organizationId: principal.organizationId,
                branchId: input.branchId,
                categoryId: category.id,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope: CREATE_CATEGORY_SCOPE,
              key: idempotencyKey,
              requestHash: hash,
              responseBody: response as unknown as Prisma.InputJsonObject,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          });

          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "The category name or idempotency key already exists.",
        );
      }
      throw error;
    }
  }

  private assertBranchPermission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ) {
    if (!hasPermission(principal, permission, branchId)) {
      throw new ForbiddenException(
        "The user lacks permission for the requested branch.",
      );
    }
  }

  private async assertBranchInOrganization(
    branchId: string,
    organizationId: string,
  ) {
    const count = await this.prisma.branch.count({
      where: { id: branchId, organizationId },
    });
    if (count !== 1) {
      throw new NotFoundException("Branch not found.");
    }
  }
}
