import type {
  BranchScheduleLifecycleRequest,
  CreateBranchScheduleRequest,
  CreateSpecialHoursRequest,
  ResolveBranchHoursPreviewRequest,
  UpdateBranchScheduleRequest,
  UpdateSpecialHoursRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BranchScheduleStatus,
  Prisma,
  SpecialHoursStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  addLocalDays,
  businessDateFor,
  isoWeekdayForDate,
  localDateTimeAt,
  resolveOpenWindow,
  type WindowAnchor,
} from "./business-date-resolver.js";
import {
  scheduleActivationIssue,
  scheduleCancellationIssue,
  specialHoursDateIssue,
} from "./branch-hours-lifecycle.js";
import {
  specialHoursConfigurationIssue,
  weeklyWindowsOverlap,
} from "./branch-hours-policy.js";

type HoursMutationResult = Readonly<{
  branchId: string;
  entityType: "branch_schedule" | "branch_special_hours";
  entityId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
  metadata?: Prisma.InputJsonObject;
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function dateOnly(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class BranchHoursService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listConfiguration(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "branch-hours.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const [schedules, specialHours] = await Promise.all([
      this.prisma.branchScheduleVersion.findMany({
        where: { branchId },
        include: {
          windows: {
            orderBy: [{ isoWeekday: "asc" }, { opensAtMinute: "asc" }],
          },
        },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.branchSpecialHours.findMany({
        where: { branchId },
        include: { windows: { orderBy: { opensAtMinute: "asc" } } },
        orderBy: [{ localDate: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return { schedules, specialHours };
  }

  async createSchedule(
    input: CreateBranchScheduleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    this.assertWeeklyWindows(input.windows);
    return this.executeIdempotent(
      "branch-hours.schedule.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const schedule = await transaction.branchScheduleVersion.create({
          data: {
            branchId: input.branchId,
            createdById: principal.userId,
            effectiveFrom: dateOnly(input.effectiveFrom),
            businessDayCutoffMinute: input.businessDayCutoffMinute,
            windows: { create: input.windows },
          },
          include: {
            windows: {
              orderBy: [{ isoWeekday: "asc" }, { opensAtMinute: "asc" }],
            },
          },
        });
        return this.result(
          input.branchId,
          "branch_schedule",
          schedule.id,
          "branch-hours.schedule.created",
          schedule,
          input.reason,
        );
      },
    );
  }

  async updateSchedule(
    scheduleId: string,
    input: UpdateBranchScheduleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    if (input.windows) this.assertWeeklyWindows(input.windows);
    return this.executeIdempotent(
      "branch-hours.schedule.update",
      idempotencyKey,
      { scheduleId, ...input },
      principal,
      async (transaction) => {
        const schedule = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(schedule.revision, input.revision);
        if (schedule.status !== BranchScheduleStatus.DRAFT) {
          throw new ConflictException(
            "Only a draft branch schedule can be edited.",
          );
        }
        const before = toJson(schedule);
        const updated = await transaction.branchScheduleVersion.updateMany({
          where: {
            id: scheduleId,
            revision: input.revision,
            status: BranchScheduleStatus.DRAFT,
          },
          data: {
            ...(input.effectiveFrom !== undefined && {
              effectiveFrom: dateOnly(input.effectiveFrom),
            }),
            ...(input.businessDayCutoffMinute !== undefined && {
              businessDayCutoffMinute: input.businessDayCutoffMinute,
            }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        if (input.windows) {
          await transaction.branchWeeklyServiceWindow.deleteMany({
            where: { scheduleId },
          });
          await transaction.branchWeeklyServiceWindow.createMany({
            data: input.windows.map((window) => ({ scheduleId, ...window })),
          });
        }
        const response = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_schedule",
          scheduleId,
          "branch-hours.schedule.updated",
          response,
          input.reason,
          { before, after: toJson(response) },
        );
      },
    );
  }

  async activateSchedule(
    scheduleId: string,
    input: BranchScheduleLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    return this.executeIdempotent(
      "branch-hours.schedule.activate",
      idempotencyKey,
      { scheduleId, ...input },
      principal,
      async (transaction) => {
        const schedule = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(schedule.revision, input.revision);
        this.assertWeeklyWindows(schedule.windows);
        const today = this.localToday(schedule.branch.timezone);
        const duplicate = await transaction.branchScheduleVersion.findFirst({
          where: {
            id: { not: scheduleId },
            branchId: input.branchId,
            effectiveFrom: schedule.effectiveFrom,
            status: BranchScheduleStatus.ACTIVE,
          },
          select: { id: true },
        });
        const activationIssue = scheduleActivationIssue({
          status: schedule.status,
          effectiveFrom: dateKey(schedule.effectiveFrom),
          localToday: today,
          duplicateActiveStart: duplicate !== null,
        });
        if (activationIssue) {
          const messages = {
            NOT_DRAFT: "Only a draft schedule can be activated.",
            PAST_EFFECTIVE_DATE:
              "A schedule cannot activate with an effective date in the past.",
            DUPLICATE_ACTIVE_START:
              "Another active schedule already starts on this local date.",
          } as const;
          throw new ConflictException(messages[activationIssue]);
        }
        const updated = await transaction.branchScheduleVersion.updateMany({
          where: {
            id: scheduleId,
            revision: input.revision,
            status: BranchScheduleStatus.DRAFT,
          },
          data: {
            status: BranchScheduleStatus.ACTIVE,
            activatedById: principal.userId,
            activatedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_schedule",
          scheduleId,
          "branch-hours.schedule.activated",
          response,
          input.reason,
        );
      },
    );
  }

  async cancelSchedule(
    scheduleId: string,
    input: BranchScheduleLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    return this.executeIdempotent(
      "branch-hours.schedule.cancel",
      idempotencyKey,
      { scheduleId, ...input },
      principal,
      async (transaction) => {
        const schedule = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(schedule.revision, input.revision);
        const today = this.localToday(schedule.branch.timezone);
        const cancellationIssue = scheduleCancellationIssue({
          status: schedule.status,
          effectiveFrom: dateKey(schedule.effectiveFrom),
          localToday: today,
        });
        if (cancellationIssue === "NOT_ACTIVE") {
          throw new ConflictException(
            "Only an active future schedule can be cancelled.",
          );
        }
        if (cancellationIssue === "ALREADY_EFFECTIVE") {
          throw new ConflictException(
            "A schedule can only be cancelled before its effective local date.",
          );
        }
        const updated = await transaction.branchScheduleVersion.updateMany({
          where: {
            id: scheduleId,
            revision: input.revision,
            status: BranchScheduleStatus.ACTIVE,
          },
          data: {
            status: BranchScheduleStatus.CANCELLED,
            endedById: principal.userId,
            endedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await this.findSchedule(
          transaction,
          scheduleId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_schedule",
          scheduleId,
          "branch-hours.schedule.cancelled",
          response,
          input.reason,
        );
      },
    );
  }

  async createSpecialHours(
    input: CreateSpecialHoursRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    this.assertSpecialHours(input.kind, input.windows);
    return this.executeIdempotent(
      "branch-hours.special.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const special = await transaction.branchSpecialHours.create({
          data: {
            branchId: input.branchId,
            createdById: principal.userId,
            localDate: dateOnly(input.localDate),
            kind: input.kind,
            label: input.label ?? null,
            windows: { create: input.windows },
          },
          include: { windows: { orderBy: { opensAtMinute: "asc" } } },
        });
        return this.result(
          input.branchId,
          "branch_special_hours",
          special.id,
          "branch-hours.special.created",
          special,
          input.reason,
        );
      },
    );
  }

  async updateSpecialHours(
    specialHoursId: string,
    input: UpdateSpecialHoursRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    return this.executeIdempotent(
      "branch-hours.special.update",
      idempotencyKey,
      { specialHoursId, ...input },
      principal,
      async (transaction) => {
        const special = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(special.revision, input.revision);
        if (special.status !== SpecialHoursStatus.DRAFT) {
          throw new ConflictException(
            "Only draft special hours can be edited; create a replacement version.",
          );
        }
        const kind = input.kind ?? special.kind;
        const windows = input.windows ?? special.windows;
        this.assertSpecialHours(kind, windows);
        const before = toJson(special);
        const updated = await transaction.branchSpecialHours.updateMany({
          where: {
            id: specialHoursId,
            revision: input.revision,
            status: SpecialHoursStatus.DRAFT,
          },
          data: {
            ...(input.localDate !== undefined && {
              localDate: dateOnly(input.localDate),
            }),
            ...(input.kind !== undefined && { kind: input.kind }),
            ...(input.label !== undefined && { label: input.label }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        if (input.windows) {
          await transaction.branchSpecialServiceWindow.deleteMany({
            where: { specialHoursId },
          });
          await transaction.branchSpecialServiceWindow.createMany({
            data: input.windows.map((window) => ({
              specialHoursId,
              ...window,
            })),
          });
        }
        const response = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_special_hours",
          specialHoursId,
          "branch-hours.special.updated",
          response,
          input.reason,
          { before, after: toJson(response) },
        );
      },
    );
  }

  async activateSpecialHours(
    specialHoursId: string,
    input: BranchScheduleLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    return this.executeIdempotent(
      "branch-hours.special.activate",
      idempotencyKey,
      { specialHoursId, ...input },
      principal,
      async (transaction) => {
        const special = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(special.revision, input.revision);
        this.assertSpecialHours(special.kind, special.windows);
        const today = this.localToday(special.branch.timezone);
        const dateIssue = specialHoursDateIssue({
          status: special.status,
          requiredStatus: "DRAFT",
          localDate: dateKey(special.localDate),
          localToday: today,
        });
        if (dateIssue === "WRONG_STATUS") {
          throw new ConflictException(
            "Only draft special hours can be activated.",
          );
        }
        if (dateIssue === "PAST_DATE") {
          throw new ConflictException(
            "Special hours cannot activate for a past local date.",
          );
        }
        const previous = await transaction.branchSpecialHours.findFirst({
          where: {
            id: { not: specialHoursId },
            branchId: input.branchId,
            localDate: special.localDate,
            status: SpecialHoursStatus.ACTIVE,
          },
        });
        if (previous) {
          const ended = await transaction.branchSpecialHours.updateMany({
            where: {
              id: previous.id,
              revision: previous.revision,
              status: SpecialHoursStatus.ACTIVE,
            },
            data: {
              status: SpecialHoursStatus.SUPERSEDED,
              endedById: principal.userId,
              endedAt: new Date(),
              revision: { increment: 1 },
            },
          });
          if (ended.count !== 1) {
            throw new ConflictException(
              "The existing special-hours version changed; refresh and retry.",
            );
          }
        }
        const activated = await transaction.branchSpecialHours.updateMany({
          where: {
            id: specialHoursId,
            revision: input.revision,
            status: SpecialHoursStatus.DRAFT,
          },
          data: {
            status: SpecialHoursStatus.ACTIVE,
            activatedById: principal.userId,
            activatedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (activated.count !== 1) this.throwRevisionConflict();
        const response = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_special_hours",
          specialHoursId,
          "branch-hours.special.activated",
          response,
          input.reason,
          previous ? { supersededSpecialHoursId: previous.id } : undefined,
        );
      },
    );
  }

  async cancelSpecialHours(
    specialHoursId: string,
    input: BranchScheduleLifecycleRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.manage", input.branchId);
    return this.executeIdempotent(
      "branch-hours.special.cancel",
      idempotencyKey,
      { specialHoursId, ...input },
      principal,
      async (transaction) => {
        const special = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(special.revision, input.revision);
        const today = this.localToday(special.branch.timezone);
        const dateIssue = specialHoursDateIssue({
          status: special.status,
          requiredStatus: "ACTIVE",
          localDate: dateKey(special.localDate),
          localToday: today,
        });
        if (dateIssue === "WRONG_STATUS") {
          throw new ConflictException(
            "Only active current or future special hours can be cancelled.",
          );
        }
        if (dateIssue === "PAST_DATE") {
          throw new ConflictException(
            "Past special-hours history cannot be cancelled.",
          );
        }
        const updated = await transaction.branchSpecialHours.updateMany({
          where: {
            id: specialHoursId,
            revision: input.revision,
            status: SpecialHoursStatus.ACTIVE,
          },
          data: {
            status: SpecialHoursStatus.CANCELLED,
            endedById: principal.userId,
            endedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await this.findSpecialHours(
          transaction,
          specialHoursId,
          input.branchId,
          principal.organizationId,
        );
        return this.result(
          input.branchId,
          "branch_special_hours",
          specialHoursId,
          "branch-hours.special.cancelled",
          response,
          input.reason,
        );
      },
    );
  }

  async resolvePreview(
    input: ResolveBranchHoursPreviewRequest,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "branch-hours.read", input.branchId);
    const branch = await this.assertBranch(
      this.prisma,
      input.branchId,
      principal.organizationId,
    );
    return this.resolveForTrustedBranch(
      input.branchId,
      branch.timezone,
      new Date(input.instant),
    );
  }

  async resolveForTrustedBranch(
    branchId: string,
    timezone: string,
    instant: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    let local;
    try {
      local = localDateTimeAt(instant, timezone);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ConflictException(
          "The branch timezone is not a valid IANA timezone.",
        );
      }
      throw error;
    }
    const effectiveSchedule = (localDate: string) =>
      client.branchScheduleVersion.findFirst({
        where: {
          branchId,
          effectiveFrom: { lte: dateOnly(localDate) },
          status: BranchScheduleStatus.ACTIVE,
        },
        include: {
          windows: {
            orderBy: [{ isoWeekday: "asc" }, { opensAtMinute: "asc" }],
          },
        },
        orderBy: { effectiveFrom: "desc" },
      });
    const anchorFor = async (localDate: string): Promise<WindowAnchor> => {
      const [schedule, special] = await Promise.all([
        effectiveSchedule(localDate),
        client.branchSpecialHours.findFirst({
          where: {
            branchId,
            localDate: dateOnly(localDate),
            status: SpecialHoursStatus.ACTIVE,
          },
          include: { windows: { orderBy: { opensAtMinute: "asc" } } },
        }),
      ]);
      if (!schedule) {
        return {
          localDate,
          scheduleVersionId: null,
          specialHoursId: special?.id ?? null,
          source: "UNCONFIGURED",
          windows: [],
        };
      }
      if (special?.kind === "CLOSED") {
        return {
          localDate,
          scheduleVersionId: schedule.id,
          specialHoursId: special.id,
          source: "SPECIAL_CLOSED",
          windows: [],
        };
      }
      if (special?.kind === "CUSTOM_HOURS") {
        return {
          localDate,
          scheduleVersionId: schedule.id,
          specialHoursId: special.id,
          source: "SPECIAL_CUSTOM",
          windows: special.windows,
        };
      }
      return {
        localDate,
        scheduleVersionId: schedule.id,
        specialHoursId: null,
        source: "WEEKLY",
        windows: schedule.windows.filter(
          (window) => window.isoWeekday === isoWeekdayForDate(localDate),
        ),
      };
    };
    const previousDate = addLocalDays(local.localDate, -1);
    const [previousAnchor, currentAnchor, schedule] = await Promise.all([
      anchorFor(previousDate),
      anchorFor(local.localDate),
      effectiveSchedule(local.localDate),
    ]);
    const activeWindow = resolveOpenWindow(
      local,
      previousAnchor,
      currentAnchor,
    );
    if (!schedule) {
      return {
        branchId,
        timezone,
        instant: instant.toISOString(),
        local,
        configurationReady: false as const,
        businessDate: null,
        scheduleVersionId: null,
        isOpen: activeWindow !== null,
        activeWindow,
        currentSource: currentAnchor.source,
        issues: [{ code: "CONFIGURATION_MISSING" as const }],
      };
    }
    return {
      branchId,
      timezone,
      instant: instant.toISOString(),
      local,
      configurationReady: true as const,
      businessDate: businessDateFor(
        local.localDate,
        local.minuteOfDay,
        schedule.businessDayCutoffMinute,
      ),
      businessDayCutoffMinute: schedule.businessDayCutoffMinute,
      scheduleVersionId: schedule.id,
      isOpen: activeWindow !== null,
      activeWindow,
      currentSource: currentAnchor.source,
      issues: [],
    };
  }

  private async findSchedule(
    client: Prisma.TransactionClient,
    scheduleId: string,
    branchId: string,
    organizationId: string,
  ) {
    const schedule = await client.branchScheduleVersion.findFirst({
      where: { id: scheduleId, branchId, branch: { organizationId } },
      include: {
        branch: true,
        windows: {
          orderBy: [{ isoWeekday: "asc" }, { opensAtMinute: "asc" }],
        },
      },
    });
    if (!schedule) throw new NotFoundException("Branch schedule not found.");
    return schedule;
  }

  private async findSpecialHours(
    client: Prisma.TransactionClient,
    specialHoursId: string,
    branchId: string,
    organizationId: string,
  ) {
    const special = await client.branchSpecialHours.findFirst({
      where: { id: specialHoursId, branchId, branch: { organizationId } },
      include: {
        branch: true,
        windows: { orderBy: { opensAtMinute: "asc" } },
      },
    });
    if (!special) throw new NotFoundException("Special hours not found.");
    return special;
  }

  private localToday(timezone: string): string {
    try {
      return localDateTimeAt(new Date(), timezone).localDate;
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ConflictException(
          "The branch timezone is not a valid IANA timezone.",
        );
      }
      throw error;
    }
  }

  private assertWeeklyWindows(
    windows: readonly {
      isoWeekday: number;
      opensAtMinute: number;
      durationMinutes: number;
    }[],
  ) {
    if (weeklyWindowsOverlap(windows)) {
      throw new BadRequestException(
        "Weekly service windows cannot overlap, including across week boundaries.",
      );
    }
  }

  private assertSpecialHours(
    kind: "CLOSED" | "CUSTOM_HOURS",
    windows: readonly {
      opensAtMinute: number;
      durationMinutes: number;
    }[],
  ) {
    const issue = specialHoursConfigurationIssue({ kind, windows });
    if (issue === "CLOSED_WITH_WINDOWS") {
      throw new BadRequestException(
        "A closed special day cannot contain service windows.",
      );
    }
    if (issue === "CUSTOM_HOURS_EMPTY") {
      throw new BadRequestException(
        "Custom special hours require at least one service window.",
      );
    }
    if (issue === "WINDOWS_OVERLAP") {
      throw new BadRequestException(
        "Special-day service windows cannot overlap.",
      );
    }
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) this.throwRevisionConflict();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The hours configuration changed since it was read. Refresh and retry.",
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
    return branch;
  }

  private result(
    branchId: string,
    entityType: "branch_schedule" | "branch_special_hours",
    entityId: string,
    eventType: string,
    response: unknown,
    reason: string,
    metadata?: Prisma.InputJsonObject,
  ): HoursMutationResult {
    return {
      branchId,
      entityType,
      entityId,
      eventType,
      response: toJson(response),
      reason,
      metadata,
    };
  }

  private async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (
      transaction: Prisma.TransactionClient,
    ) => Promise<HoursMutationResult>,
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
              metadata: {
                deviceId: principal.deviceId,
                ...(result.metadata ?? {}),
              },
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
        ["P2002", "P2004", "P2034"].includes(error.code)
      ) {
        throw new ConflictException(
          "The hours configuration conflicts with an existing version or concurrent change.",
        );
      }
      throw error;
    }
  }
}
