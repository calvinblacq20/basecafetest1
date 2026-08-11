import type {
  CreateDiningAreaRequest,
  CreateDiningTableRequest,
  LayoutLifecycleRequest,
  UpdateDiningAreaRequest,
  UpdateDiningTableRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  diningAreaDeactivationIssue,
  diningTableActivationIssue,
} from "./layout-policy.js";

type LayoutMutationResult = Readonly<{
  branchId: string;
  entityType: "dining_area" | "dining_table";
  entityId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase("en");
}

function publicArea<T extends { nameKey: string }>(area: T) {
  const visible = { ...area };
  Reflect.deleteProperty(visible, "nameKey");
  return visible as Omit<T, "nameKey">;
}

function publicTable<T extends { nameKey: string }>(table: T) {
  const visible = { ...table };
  Reflect.deleteProperty(visible, "nameKey");
  return visible as Omit<T, "nameKey">;
}

@Injectable()
export class LayoutService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAreas(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "layout.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const areas = await this.prisma.diningArea.findMany({
      where: { branchId },
      include: {
        tables: {
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return areas.map((area) => ({
      ...publicArea(area),
      tables: area.tables.map(publicTable),
    }));
  }

  async listTables(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "layout.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const tables = await this.prisma.diningTable.findMany({
      where: { branchId },
      include: { diningArea: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return tables.map((table) => ({
      ...publicTable(table),
      diningArea: publicArea(table.diningArea),
    }));
  }

  async createArea(
    input: CreateDiningAreaRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    return this.executeIdempotent(
      "layout.area.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const area = await transaction.diningArea.create({
          data: {
            branchId: input.branchId,
            externalKey: input.externalKey ?? null,
            name: input.name,
            nameKey: nameKey(input.name),
            displayOrder: input.displayOrder,
            isActive: false,
          },
        });
        return this.result(
          input.branchId,
          "dining_area",
          area.id,
          "layout.area.created",
          publicArea(area),
          input.reason,
        );
      },
    );
  }

  async updateArea(
    areaId: string,
    input: UpdateDiningAreaRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    return this.executeIdempotent(
      "layout.area.update",
      idempotencyKey,
      { areaId, ...input },
      principal,
      async (transaction) => {
        const area = await this.findArea(
          transaction,
          areaId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(area.revision, input.revision);
        const updated = await transaction.diningArea.updateMany({
          where: { id: areaId, revision: input.revision },
          data: {
            ...(input.name !== undefined && {
              name: input.name,
              nameKey: nameKey(input.name),
            }),
            ...(input.displayOrder !== undefined && {
              displayOrder: input.displayOrder,
            }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.diningArea.findUniqueOrThrow({
          where: { id: areaId },
        });
        return this.result(
          input.branchId,
          "dining_area",
          areaId,
          "layout.area.updated",
          publicArea(response),
          input.reason,
        );
      },
    );
  }

  async activateArea(
    areaId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    return this.changeAreaStatus(
      areaId,
      input,
      idempotencyKey,
      principal,
      true,
    );
  }

  async deactivateArea(
    areaId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    return this.changeAreaStatus(
      areaId,
      input,
      idempotencyKey,
      principal,
      false,
    );
  }

  async createTable(
    input: CreateDiningTableRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    return this.executeIdempotent(
      "layout.table.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.findArea(
          transaction,
          input.diningAreaId,
          input.branchId,
          principal.organizationId,
        );
        const table = await transaction.diningTable.create({
          data: {
            branchId: input.branchId,
            diningAreaId: input.diningAreaId,
            externalKey: input.externalKey ?? null,
            name: input.name,
            nameKey: nameKey(input.name),
            capacity: input.capacity,
            combinableGroup: input.combinableGroup ?? null,
            displayOrder: input.displayOrder,
            positionX: input.positionX ?? null,
            positionY: input.positionY ?? null,
            isActive: false,
          },
        });
        return this.result(
          input.branchId,
          "dining_table",
          table.id,
          "layout.table.created",
          publicTable(table),
          input.reason,
        );
      },
    );
  }

  async updateTable(
    tableId: string,
    input: UpdateDiningTableRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    return this.executeIdempotent(
      "layout.table.update",
      idempotencyKey,
      { tableId, ...input },
      principal,
      async (transaction) => {
        const table = await this.findTable(
          transaction,
          tableId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(table.revision, input.revision);
        if (input.diningAreaId !== undefined) {
          const area = await this.findArea(
            transaction,
            input.diningAreaId,
            input.branchId,
            principal.organizationId,
          );
          if (table.isActive && !area.isActive) {
            throw new ConflictException(
              "An active table cannot move into an inactive dining area.",
            );
          }
        }
        const updated = await transaction.diningTable.updateMany({
          where: { id: tableId, revision: input.revision },
          data: {
            ...(input.diningAreaId !== undefined && {
              diningAreaId: input.diningAreaId,
            }),
            ...(input.name !== undefined && {
              name: input.name,
              nameKey: nameKey(input.name),
            }),
            ...(input.capacity !== undefined && { capacity: input.capacity }),
            ...(input.combinableGroup !== undefined && {
              combinableGroup: input.combinableGroup,
            }),
            ...(input.displayOrder !== undefined && {
              displayOrder: input.displayOrder,
            }),
            ...(input.positionX !== undefined && {
              positionX: input.positionX,
              positionY: input.positionY,
            }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.diningTable.findUniqueOrThrow({
          where: { id: tableId },
        });
        return this.result(
          input.branchId,
          "dining_table",
          tableId,
          "layout.table.updated",
          publicTable(response),
          input.reason,
        );
      },
    );
  }

  async activateTable(
    tableId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    return this.changeTableStatus(
      tableId,
      input,
      idempotencyKey,
      principal,
      true,
    );
  }

  async deactivateTable(
    tableId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    return this.changeTableStatus(
      tableId,
      input,
      idempotencyKey,
      principal,
      false,
    );
  }

  private async changeAreaStatus(
    areaId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
    active: boolean,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    const action = active ? "activate" : "deactivate";
    return this.executeIdempotent(
      `layout.area.${action}`,
      idempotencyKey,
      { areaId, ...input },
      principal,
      async (transaction) => {
        const area = await this.findArea(
          transaction,
          areaId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(area.revision, input.revision);
        if (area.isActive === active) {
          throw new ConflictException(
            `The dining area is already ${active ? "active" : "inactive"}.`,
          );
        }
        if (!active) {
          const activeTables = await transaction.diningTable.count({
            where: {
              diningAreaId: areaId,
              branchId: input.branchId,
              isActive: true,
            },
          });
          if (diningAreaDeactivationIssue(activeTables)) {
            throw new ConflictException(
              "Deactivate all tables in this dining area first.",
            );
          }
        }
        const updated = await transaction.diningArea.updateMany({
          where: { id: areaId, revision: input.revision },
          data: { isActive: active, revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.diningArea.findUniqueOrThrow({
          where: { id: areaId },
        });
        return this.result(
          input.branchId,
          "dining_area",
          areaId,
          `layout.area.${active ? "activated" : "deactivated"}`,
          publicArea(response),
          input.reason,
        );
      },
    );
  }

  private async changeTableStatus(
    tableId: string,
    input: LayoutLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
    active: boolean,
  ) {
    this.assertPermission(principal, "layout.manage", input.branchId);
    const action = active ? "activate" : "deactivate";
    return this.executeIdempotent(
      `layout.table.${action}`,
      idempotencyKey,
      { tableId, ...input },
      principal,
      async (transaction) => {
        const table = await transaction.diningTable.findFirst({
          where: {
            id: tableId,
            branchId: input.branchId,
            branch: { organizationId: principal.organizationId },
          },
          include: { diningArea: true },
        });
        if (!table) throw new NotFoundException("Dining table not found.");
        this.assertRevision(table.revision, input.revision);
        if (active) {
          const issue = diningTableActivationIssue(
            table.isActive,
            table.diningArea.isActive,
          );
          if (issue === "ALREADY_ACTIVE") {
            throw new ConflictException("The dining table is already active.");
          }
          if (issue === "AREA_INACTIVE") {
            throw new ConflictException(
              "Activate the dining area before activating its table.",
            );
          }
        } else if (!table.isActive) {
          throw new ConflictException("The dining table is already inactive.");
        }
        const updated = await transaction.diningTable.updateMany({
          where: { id: tableId, revision: input.revision },
          data: { isActive: active, revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.diningTable.findUniqueOrThrow({
          where: { id: tableId },
        });
        return this.result(
          input.branchId,
          "dining_table",
          tableId,
          `layout.table.${active ? "activated" : "deactivated"}`,
          publicTable(response),
          input.reason,
        );
      },
    );
  }

  private async findArea(
    client: Prisma.TransactionClient,
    areaId: string,
    branchId: string,
    organizationId: string,
  ) {
    const area = await client.diningArea.findFirst({
      where: { id: areaId, branchId, branch: { organizationId } },
    });
    if (!area) throw new NotFoundException("Dining area not found.");
    return area;
  }

  private async findTable(
    client: Prisma.TransactionClient,
    tableId: string,
    branchId: string,
    organizationId: string,
  ) {
    const table = await client.diningTable.findFirst({
      where: { id: tableId, branchId, branch: { organizationId } },
    });
    if (!table) throw new NotFoundException("Dining table not found.");
    return table;
  }

  private result(
    branchId: string,
    entityType: "dining_area" | "dining_table",
    entityId: string,
    eventType: string,
    response: unknown,
    reason: string,
  ): LayoutMutationResult {
    return {
      branchId,
      entityType,
      entityId,
      eventType,
      response: toJson(response),
      reason,
    };
  }

  private async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (
      transaction: Prisma.TransactionClient,
    ) => Promise<LayoutMutationResult>,
  ) {
    const hashValue = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hashValue) {
        throw new ConflictException(
          "The idempotency key was already used with a different request.",
        );
      }
      return existing.responseBody;
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const result = await work(transaction);
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: result.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: result.entityType,
              entityId: result.entityId,
              reason: result.reason,
              metadata: { deviceId: principal.deviceId },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: result.entityType,
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: result.branchId,
                entityId: result.entityId,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
              requestHash: hashValue,
              responseBody: result.response,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          });
          return result.response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "The dining-area/table name, external key, or idempotency key already exists.",
        );
      }
      throw error;
    }
  }

  private assertRevision(actual: number, expected: number): void {
    if (actual !== expected) this.throwRevisionConflict();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The layout record changed since it was read. Refresh and retry.",
    );
  }

  private assertPermission(
    principal: AuthPrincipal,
    permission: string,
    branchId: string,
  ): void {
    if (!hasPermission(principal, permission, branchId)) {
      throw new ForbiddenException(
        "The user lacks dining-layout permission for this branch.",
      );
    }
  }

  private async assertBranch(
    client: Prisma.TransactionClient | PrismaService,
    branchId: string,
    organizationId: string,
  ): Promise<void> {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
  }
}
