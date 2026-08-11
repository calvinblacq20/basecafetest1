import type {
  ActivateDeviceRequest,
  AssignStaffRoleRequest,
  CreateDeviceRequest,
  CreateRoleRequest,
  CreateStaffRequest,
  DisableStaffRequest,
  ReactivateStaffRequest,
  RemoveStaffRoleRequest,
  RevokeDeviceRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { hash } from "@node-rs/argon2";
import { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  roleRemovalIssue,
  ungrantablePermissions,
} from "./administration-policy.js";

type AdministrationMutationResult = Readonly<{
  branchId?: string;
  entityType: string;
  entityId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason?: string;
}>;

type UserWithRoles = Prisma.UserGetPayload<{
  include: { roles: { include: { role: true } } };
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function publicDevice(device: {
  id: string;
  branchId: string;
  name: string;
  status: string;
  revision: number;
  fingerprintHash: string | null;
  enrolledAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: device.id,
    branchId: device.branchId,
    name: device.name,
    status: device.status,
    revision: device.revision,
    fingerprintBound: Boolean(device.fingerprintHash),
    enrolledAt: device.enrolledAt,
    revokedAt: device.revokedAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

function publicRole(role: {
  id: string;
  name: string;
  scope: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: { permissionKey: string }[];
}) {
  return {
    id: role.id,
    name: role.name,
    scope: role.scope,
    isSystem: role.isSystem,
    permissionKeys: role.permissions
      .map(({ permissionKey }) => permissionKey)
      .sort((left, right) => left.localeCompare(right)),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function publicStaff(user: UserWithRoles) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    revision: user.revision,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    assignments: user.roles.map((assignment) => ({
      id: assignment.id,
      branchId: assignment.branchId,
      assignedAt: assignment.assignedAt,
      revokedAt: assignment.revokedAt,
      revokedById: assignment.revokedById,
      revocationReason: assignment.revocationReason,
      role: {
        id: assignment.role.id,
        name: assignment.role.name,
        scope: assignment.role.scope,
      },
    })),
  };
}

@Injectable()
export class AdministrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPermissions(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "roles.manage", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    return this.prisma.permission.findMany({ orderBy: { key: "asc" } });
  }

  async listRoles(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "roles.manage", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const roles = await this.prisma.role.findMany({
      where: { organizationId: principal.organizationId },
      include: { permissions: true },
      orderBy: { name: "asc" },
    });
    return roles.map(publicRole);
  }

  async createRole(
    input: CreateRoleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "roles.manage", input.branchId);
    if (
      input.scope === "ORGANIZATION" &&
      !hasPermission(principal, "roles.manage")
    ) {
      throw new ForbiddenException(
        "Organization-wide roles require organization-wide role management.",
      );
    }
    this.assertCanGrantPermissions(
      principal,
      input.permissionKeys,
      input.scope,
      input.branchId,
    );

    return this.executeIdempotent(
      "administration.role.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const permissions = await transaction.permission.findMany({
          where: { key: { in: input.permissionKeys } },
          select: { key: true },
        });
        if (permissions.length !== input.permissionKeys.length) {
          throw new BadRequestException(
            "One or more permission keys are not registered.",
          );
        }
        const role = await transaction.role.create({
          data: {
            organizationId: principal.organizationId,
            name: input.name,
            scope: input.scope,
            permissions: {
              create: input.permissionKeys.map((permissionKey) => ({
                permissionKey,
              })),
            },
          },
          include: { permissions: true },
        });
        return {
          branchId: input.branchId,
          entityType: "role",
          entityId: role.id,
          eventType: "administration.role.created",
          response: toJson(publicRole(role)),
          reason: input.reason,
        };
      },
    );
  }

  async listStaff(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "staff.manage", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: principal.organizationId,
        roles: {
          some: {
            revokedAt: null,
            OR: [
              { branchId },
              { branchId: null, role: { scope: "ORGANIZATION" } },
            ],
          },
        },
      },
      include: { roles: { include: { role: true } } },
      orderBy: { displayName: "asc" },
    });
    return users.map(publicStaff);
  }

  async createStaff(
    input: CreateStaffRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "staff.manage", input.branchId);
    const passwordHash = await hash(input.initialPassword, {
      algorithm: 2,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    });
    const command = {
      ...input,
      initialPassword: "[REDACTED]",
    };

    return this.executeIdempotent(
      "administration.staff.create",
      idempotencyKey,
      command,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const roles = await this.loadAssignableRoles(
          transaction,
          input.roleIds,
          input.branchId,
          principal,
        );
        const user = await transaction.user.create({
          data: {
            organizationId: principal.organizationId,
            email: input.email.trim().toLowerCase(),
            displayName: input.displayName,
            passwordHash,
            mustChangePassword: true,
            roles: {
              create: roles.map((role) => ({
                roleId: role.id,
                branchId: role.scope === "BRANCH" ? input.branchId : null,
                assignedById: principal.userId,
              })),
            },
          },
          include: { roles: { include: { role: true } } },
        });
        return {
          branchId: input.branchId,
          entityType: "user",
          entityId: user.id,
          eventType: "administration.staff.created",
          response: toJson(publicStaff(user)),
          reason: input.reason,
        };
      },
    );
  }

  async assignStaffRole(
    userId: string,
    input: AssignStaffRoleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "staff.manage", input.branchId);
    return this.executeIdempotent(
      "administration.staff.role.assign",
      idempotencyKey,
      { userId, ...input },
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const user = await transaction.user.findFirst({
          where: { id: userId, organizationId: principal.organizationId },
        });
        if (!user) throw new NotFoundException("Staff member not found.");
        this.assertRevision(user.revision, input.revision);
        const [role] = await this.loadAssignableRoles(
          transaction,
          [input.roleId],
          input.branchId,
          principal,
        );
        if (!role) throw new NotFoundException("Role not found.");
        const assignmentBranchId =
          role.scope === "BRANCH" ? input.branchId : null;
        const existing = await transaction.userRole.findFirst({
          where: {
            userId,
            roleId: role.id,
            branchId: assignmentBranchId,
            revokedAt: null,
          },
        });
        if (existing) {
          throw new ConflictException("The staff role is already assigned.");
        }
        const assignment = await transaction.userRole.create({
          data: {
            userId,
            roleId: role.id,
            branchId: assignmentBranchId,
            assignedById: principal.userId,
          },
        });
        const updated = await transaction.user.updateMany({
          where: { id: userId, revision: input.revision },
          data: { revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await this.findStaff(transaction, userId);
        return {
          branchId: input.branchId,
          entityType: "user_role",
          entityId: assignment.id,
          eventType: "administration.staff.role.assigned",
          response: toJson(publicStaff(response)),
          reason: input.reason,
        };
      },
    );
  }

  async removeStaffRole(
    userId: string,
    assignmentId: string,
    input: RemoveStaffRoleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "staff.manage", input.branchId);
    return this.executeIdempotent(
      "administration.staff.role.remove",
      idempotencyKey,
      { userId, assignmentId, ...input },
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const user = await transaction.user.findFirst({
          where: { id: userId, organizationId: principal.organizationId },
          include: {
            roles: {
              where: { revokedAt: null },
              include: { role: true },
            },
          },
        });
        if (!user) throw new NotFoundException("Staff member not found.");
        this.assertRevision(user.revision, input.revision);
        const assignment = await transaction.userRole.findFirst({
          where: {
            id: assignmentId,
            userId,
            revokedAt: null,
            user: { organizationId: principal.organizationId },
          },
          include: { role: true },
        });
        if (!assignment) {
          throw new NotFoundException(
            "Active staff role assignment not found.",
          );
        }
        if (assignment.role.scope === "ORGANIZATION") {
          if (!hasPermission(principal, "staff.manage")) {
            throw new ForbiddenException(
              "Removing an organization role requires organization-wide staff management.",
            );
          }
        } else if (assignment.branchId !== input.branchId) {
          throw new NotFoundException(
            "The role assignment is not active in the requested branch.",
          );
        }
        const issue = roleRemovalIssue(
          principal.userId,
          userId,
          user.roles.length,
        );
        if (issue === "SELF_REMOVAL") {
          throw new BadRequestException(
            "The current user cannot remove its own role assignment.",
          );
        }
        if (issue === "LAST_ACTIVE_ASSIGNMENT") {
          throw new ConflictException(
            "The final active role cannot be removed; disable the staff account instead.",
          );
        }
        const revokedAt = new Date();
        const removed = await transaction.userRole.updateMany({
          where: { id: assignmentId, revokedAt: null },
          data: {
            revokedAt,
            revokedById: principal.userId,
            revocationReason: input.reason,
          },
        });
        if (removed.count !== 1) this.throwRevisionConflict();
        const updated = await transaction.user.updateMany({
          where: { id: userId, revision: input.revision },
          data: { revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        await transaction.session.updateMany({
          where: { userId, status: "ACTIVE" },
          data: {
            status: "REVOKED",
            revision: { increment: 1 },
            revokedById: principal.userId,
            revokedAt,
            revocationReason: input.reason,
          },
        });
        const response = await this.findStaff(transaction, userId);
        return {
          branchId: input.branchId,
          entityType: "user_role",
          entityId: assignmentId,
          eventType: "administration.staff.role.removed",
          response: toJson(publicStaff(response)),
          reason: input.reason,
        };
      },
    );
  }
  async disableStaff(
    userId: string,
    input: DisableStaffRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    if (!hasPermission(principal, "staff.manage")) {
      throw new ForbiddenException(
        "Disabling a staff account requires organization-wide staff management.",
      );
    }
    if (userId === principal.userId) {
      throw new BadRequestException("The current user cannot disable itself.");
    }
    return this.executeIdempotent(
      "administration.staff.disable",
      idempotencyKey,
      { userId, ...input },
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const user = await transaction.user.findFirst({
          where: { id: userId, organizationId: principal.organizationId },
        });
        if (!user) throw new NotFoundException("Staff member not found.");
        this.assertRevision(user.revision, input.revision);
        if (user.status === "DISABLED") {
          throw new ConflictException("The staff account is already disabled.");
        }
        const updated = await transaction.user.updateMany({
          where: { id: userId, revision: input.revision },
          data: { status: "DISABLED", revision: { increment: 1 } },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        await transaction.session.updateMany({
          where: { userId, status: "ACTIVE" },
          data: {
            status: "REVOKED",
            revision: { increment: 1 },
            revokedById: principal.userId,
            revokedAt: new Date(),
            revocationReason: input.reason,
          },
        });
        const response = await this.findStaff(transaction, userId);
        return {
          branchId: input.branchId,
          entityType: "user",
          entityId: userId,
          eventType: "administration.staff.disabled",
          response: toJson(publicStaff(response)),
          reason: input.reason,
        };
      },
    );
  }

  async reactivateStaff(
    userId: string,
    input: ReactivateStaffRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    if (!hasPermission(principal, "staff.manage")) {
      throw new ForbiddenException(
        "Reactivating staff requires organization-wide staff management.",
      );
    }
    return this.executeIdempotent(
      "administration.staff.reactivate",
      idempotencyKey,
      { userId, ...input },
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const user = await transaction.user.findFirst({
          where: { id: userId, organizationId: principal.organizationId },
          include: {
            roles: {
              where: { revokedAt: null },
              include: { role: { include: { permissions: true } } },
            },
          },
        });
        if (!user) throw new NotFoundException("Staff member not found.");
        this.assertRevision(user.revision, input.revision);
        if (user.status === "ACTIVE") {
          throw new ConflictException("The staff account is already active.");
        }
        if (user.roles.length === 0) {
          throw new ConflictException(
            "A staff account requires at least one active role before reactivation.",
          );
        }
        for (const assignment of user.roles) {
          const permissionKeys = assignment.role.permissions.map(
            ({ permissionKey }) => permissionKey,
          );
          if (assignment.role.scope === "ORGANIZATION") {
            this.assertCanGrantPermissions(
              principal,
              permissionKeys,
              "ORGANIZATION",
              input.branchId,
            );
          } else {
            if (!assignment.branchId) {
              throw new ConflictException(
                "A branch-scoped role assignment is missing its branch.",
              );
            }
            await this.assertBranch(
              transaction,
              assignment.branchId,
              principal.organizationId,
            );
            this.assertCanGrantPermissions(
              principal,
              permissionKeys,
              "BRANCH",
              assignment.branchId,
            );
          }
        }
        const updated = await transaction.user.updateMany({
          where: { id: userId, revision: input.revision, status: "DISABLED" },
          data: {
            status: "ACTIVE",
            mustChangePassword: true,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        await transaction.session.updateMany({
          where: { userId, status: "ACTIVE" },
          data: {
            status: "REVOKED",
            revision: { increment: 1 },
            revokedById: principal.userId,
            revokedAt: new Date(),
            revocationReason: input.reason,
          },
        });
        const response = await this.findStaff(transaction, userId);
        return {
          branchId: input.branchId,
          entityType: "user",
          entityId: userId,
          eventType: "administration.staff.reactivated",
          response: toJson(publicStaff(response)),
          reason: input.reason,
        };
      },
    );
  }
  async listDevices(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "device.manage", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const devices = await this.prisma.device.findMany({
      where: { branchId, organizationId: principal.organizationId },
      orderBy: { name: "asc" },
    });
    return devices.map(publicDevice);
  }

  async createDevice(
    input: CreateDeviceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "device.manage", input.branchId);
    return this.executeIdempotent(
      "administration.device.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const device = await transaction.device.create({
          data: {
            organizationId: principal.organizationId,
            branchId: input.branchId,
            name: input.name,
            status: "PENDING",
          },
        });
        return {
          branchId: input.branchId,
          entityType: "device",
          entityId: device.id,
          eventType: "administration.device.created",
          response: toJson(publicDevice(device)),
        };
      },
    );
  }

  async activateDevice(
    deviceId: string,
    input: ActivateDeviceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "device.manage", input.branchId);
    return this.changeDeviceStatus(
      deviceId,
      input,
      idempotencyKey,
      principal,
      "ACTIVE",
    );
  }

  async revokeDevice(
    deviceId: string,
    input: RevokeDeviceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "device.manage", input.branchId);
    return this.changeDeviceStatus(
      deviceId,
      input,
      idempotencyKey,
      principal,
      "REVOKED",
    );
  }

  private async changeDeviceStatus(
    deviceId: string,
    input: ActivateDeviceRequest | RevokeDeviceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
    status: "ACTIVE" | "REVOKED",
  ) {
    const scope = `administration.device.${status.toLowerCase()}`;
    return this.executeIdempotent(
      scope,
      idempotencyKey,
      { deviceId, ...input },
      principal,
      async (transaction) => {
        const device = await transaction.device.findFirst({
          where: {
            id: deviceId,
            branchId: input.branchId,
            organizationId: principal.organizationId,
          },
        });
        if (!device) throw new NotFoundException("Device not found.");
        this.assertRevision(device.revision, input.revision);
        if (status === "ACTIVE" && device.status !== "PENDING") {
          throw new ConflictException("Only pending devices can be activated.");
        }
        if (status === "REVOKED" && device.status === "REVOKED") {
          throw new ConflictException("The device is already revoked.");
        }
        const fingerprintHash =
          "fingerprintHash" in input
            ? input.fingerprintHash.toLowerCase()
            : device.fingerprintHash;
        const updated = await transaction.device.updateMany({
          where: { id: deviceId, revision: input.revision },
          data: {
            status,
            revision: { increment: 1 },
            ...(status === "ACTIVE"
              ? { fingerprintHash, enrolledAt: new Date(), revokedAt: null }
              : { revokedAt: new Date() }),
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        if (status === "REVOKED") {
          await transaction.session.updateMany({
            where: { deviceId, status: "ACTIVE" },
            data: {
              status: "REVOKED",
              revision: { increment: 1 },
              revokedById: principal.userId,
              revokedAt: new Date(),
              revocationReason: input.reason,
            },
          });
        }
        const response = await transaction.device.findUniqueOrThrow({
          where: { id: deviceId },
        });
        return {
          branchId: input.branchId,
          entityType: "device",
          entityId: deviceId,
          eventType:
            status === "ACTIVE"
              ? "administration.device.activated"
              : "administration.device.revoked",
          response: toJson(publicDevice(response)),
          reason: input.reason,
        };
      },
    );
  }

  private async loadAssignableRoles(
    transaction: Prisma.TransactionClient,
    roleIds: string[],
    branchId: string,
    principal: AuthPrincipal,
  ) {
    const roles = await transaction.role.findMany({
      where: {
        id: { in: roleIds },
        organizationId: principal.organizationId,
      },
      include: { permissions: true },
    });
    if (roles.length !== roleIds.length) {
      throw new NotFoundException("One or more roles were not found.");
    }
    for (const role of roles) {
      if (
        role.scope === "ORGANIZATION" &&
        !hasPermission(principal, "staff.manage")
      ) {
        throw new ForbiddenException(
          "Organization-wide assignments require organization-wide staff management.",
        );
      }
      this.assertCanGrantPermissions(
        principal,
        role.permissions.map(({ permissionKey }) => permissionKey),
        role.scope,
        branchId,
      );
    }
    return roles;
  }

  private assertCanGrantPermissions(
    principal: AuthPrincipal,
    permissionKeys: readonly string[],
    scope: "ORGANIZATION" | "BRANCH",
    branchId: string,
  ) {
    const unauthorized = ungrantablePermissions(
      principal,
      permissionKeys,
      scope,
      branchId,
    );
    if (unauthorized.length) {
      throw new ForbiddenException(
        "Administrators cannot grant permissions they do not hold at the target scope.",
      );
    }
  }

  private async findStaff(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<UserWithRoles> {
    return transaction.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
  }

  private async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (
      transaction: Prisma.TransactionClient,
    ) => Promise<AdministrationMutationResult>,
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
              branchId: result.branchId ?? null,
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
                branchId: result.branchId ?? null,
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
          "The staff, role, device or idempotency key already exists.",
        );
      }
      throw error;
    }
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) this.throwRevisionConflict();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The administration record changed since it was read. Refresh and retry.",
    );
  }

  private assertPermission(
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

  private async assertBranch(
    client: Prisma.TransactionClient | PrismaService,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
  }
}
