import type {
  ActivateTaxProfileRequest,
  ConfirmTaxProfileRequest,
  CreateTaxProfileRequest,
  TaxCalculationPreviewRequest,
  UpdateTaxProfileRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TaxProfileStatus } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { calculateTax } from "./tax-calculator.js";
import { taxProfileActivationIssue } from "./tax-profile-policy.js";

type TaxMutationResult = Readonly<{
  branchId: string;
  entityId: string;
  eventType: string;
  response: Prisma.InputJsonObject;
  reason: string;
  auditMetadata?: Prisma.InputJsonObject;
}>;

type TaxProfileWithComponents = Prisma.TaxProfileGetPayload<{
  include: { components: true };
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

@Injectable()
export class TaxService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listProfiles(branchId: string, principal: AuthPrincipal) {
    this.assertPermission(principal, "tax.read", branchId);
    await this.assertBranch(this.prisma, branchId, principal.organizationId);
    const profiles = await this.prisma.taxProfile.findMany({
      where: { branchId },
      include: {
        components: { orderBy: { calculationOrder: "asc" } },
      },
      orderBy: [{ effectiveFrom: "desc" }, { key: "asc" }],
    });
    return profiles.map((profile) => this.publicProfile(profile));
  }

  async createProfile(
    input: CreateTaxProfileRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.configure", input.branchId);
    return this.executeIdempotent(
      "tax.profile.create",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        const branch = await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const effectiveFrom = new Date(input.effectiveFrom);
        const effectiveTo = input.effectiveTo
          ? new Date(input.effectiveTo)
          : null;
        this.assertInterval(effectiveFrom, effectiveTo);
        const profile = await transaction.taxProfile.create({
          data: {
            branchId: input.branchId,
            createdById: principal.userId,
            key: input.key,
            name: input.name,
            priceMode: input.priceMode,
            roundingMode: input.roundingMode,
            roundingScope: input.roundingScope,
            currency: branch.currency,
            effectiveFrom,
            effectiveTo,
            status: TaxProfileStatus.DRAFT,
            components: {
              create: input.components.map((component) => ({
                code: component.code,
                receiptLabel: component.receiptLabel,
                ratePpm: component.ratePpm,
                calculationOrder: component.calculationOrder,
              })),
            },
          },
          include: { components: { orderBy: { calculationOrder: "asc" } } },
        });
        return this.result(
          input.branchId,
          profile.id,
          "tax.profile.created",
          this.publicProfile(profile),
          input.reason,
          { activationBlockedUntilApprovalRecorded: true },
        );
      },
    );
  }

  async updateProfile(
    profileId: string,
    input: UpdateTaxProfileRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.configure", input.branchId);
    return this.executeIdempotent(
      "tax.profile.update",
      idempotencyKey,
      { profileId, ...input },
      principal,
      async (transaction) => {
        const profile = await this.findProfile(
          transaction,
          profileId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(profile.revision, input.revision);
        if (profile.status !== TaxProfileStatus.DRAFT) {
          throw new ConflictException(
            "Confirmed tax profiles are immutable; create a new effective-dated profile version.",
          );
        }
        const effectiveFrom = input.effectiveFrom
          ? new Date(input.effectiveFrom)
          : profile.effectiveFrom;
        const effectiveTo =
          input.effectiveTo !== undefined
            ? input.effectiveTo
              ? new Date(input.effectiveTo)
              : null
            : profile.effectiveTo;
        this.assertInterval(effectiveFrom, effectiveTo);
        const before = toJson(profile);

        const updated = await transaction.taxProfile.updateMany({
          where: {
            id: profileId,
            revision: input.revision,
            status: TaxProfileStatus.DRAFT,
          },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.priceMode !== undefined && {
              priceMode: input.priceMode,
            }),
            ...(input.roundingMode !== undefined && {
              roundingMode: input.roundingMode,
            }),
            ...(input.roundingScope !== undefined && {
              roundingScope: input.roundingScope,
            }),
            ...(input.effectiveFrom !== undefined && { effectiveFrom }),
            ...(input.effectiveTo !== undefined && { effectiveTo }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        if (input.components) {
          await transaction.taxComponent.deleteMany({
            where: { taxProfileId: profileId },
          });
          await transaction.taxComponent.createMany({
            data: input.components.map((component) => ({
              taxProfileId: profileId,
              code: component.code,
              receiptLabel: component.receiptLabel,
              ratePpm: component.ratePpm,
              calculationOrder: component.calculationOrder,
            })),
          });
        }
        const response = await transaction.taxProfile.findUniqueOrThrow({
          where: { id: profileId },
          include: { components: { orderBy: { calculationOrder: "asc" } } },
        });
        return this.result(
          input.branchId,
          profileId,
          "tax.profile.updated",
          this.publicProfile(response),
          input.reason,
          { before, after: toJson(response) },
        );
      },
    );
  }

  async confirmProfile(
    profileId: string,
    input: ConfirmTaxProfileRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.approve", input.branchId);
    return this.executeIdempotent(
      "tax.profile.confirm",
      idempotencyKey,
      { profileId, ...input },
      principal,
      async (transaction) => {
        const profile = await this.findProfile(
          transaction,
          profileId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(profile.revision, input.revision);
        if (profile.status !== TaxProfileStatus.DRAFT) {
          throw new ConflictException(
            "Only a draft tax profile can record approval.",
          );
        }
        const updated = await transaction.taxProfile.updateMany({
          where: {
            id: profileId,
            revision: input.revision,
            status: TaxProfileStatus.DRAFT,
          },
          data: {
            status: TaxProfileStatus.CONFIRMED,
            approvalReference: input.approvalReference,
            confirmationRecordedById: principal.userId,
            confirmedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.taxProfile.findUniqueOrThrow({
          where: { id: profileId },
          include: { components: { orderBy: { calculationOrder: "asc" } } },
        });
        return this.result(
          input.branchId,
          profileId,
          "tax.profile.confirmed",
          this.publicProfile(response),
          input.reason,
          { approvalReference: input.approvalReference },
        );
      },
    );
  }

  async activateProfile(
    profileId: string,
    input: ActivateTaxProfileRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.configure", input.branchId);
    return this.executeIdempotent(
      "tax.profile.activate",
      idempotencyKey,
      { profileId, ...input },
      principal,
      async (transaction) => {
        const profile = await this.findProfile(
          transaction,
          profileId,
          input.branchId,
          principal.organizationId,
        );
        this.assertRevision(profile.revision, input.revision);
        const activationIssue = taxProfileActivationIssue({
          status: profile.status,
          approvalReference: profile.approvalReference,
          confirmationRecordedById: profile.confirmationRecordedById,
          confirmedAt: profile.confirmedAt,
          effectiveTo: profile.effectiveTo,
          now: new Date(),
        });
        if (activationIssue === "APPROVAL_NOT_RECORDED") {
          throw new ConflictException(
            "Record owner/accountant/GRA approval evidence before activation.",
          );
        }
        if (activationIssue === "ALREADY_EXPIRED") {
          throw new ConflictException(
            "An already expired tax profile cannot be activated.",
          );
        }
        const overlap = await transaction.taxProfile.findFirst({
          where: {
            id: { not: profileId },
            branchId: input.branchId,
            status: TaxProfileStatus.ACTIVE,
            ...(profile.effectiveTo
              ? { effectiveFrom: { lt: profile.effectiveTo } }
              : {}),
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: profile.effectiveFrom } },
            ],
          },
          select: { id: true },
        });
        if (overlap) {
          throw new ConflictException(
            "The profile interval overlaps another active branch tax profile.",
          );
        }
        const updated = await transaction.taxProfile.updateMany({
          where: {
            id: profileId,
            revision: input.revision,
            status: TaxProfileStatus.CONFIRMED,
          },
          data: {
            status: TaxProfileStatus.ACTIVE,
            activatedById: principal.userId,
            activatedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.throwRevisionConflict();
        const response = await transaction.taxProfile.findUniqueOrThrow({
          where: { id: profileId },
          include: { components: { orderBy: { calculationOrder: "asc" } } },
        });
        return this.result(
          input.branchId,
          profileId,
          "tax.profile.activated",
          this.publicProfile(response),
          input.reason,
          {
            approvalReference: profile.approvalReference,
            effectiveFrom: profile.effectiveFrom.toISOString(),
            effectiveTo: profile.effectiveTo?.toISOString() ?? null,
          },
        );
      },
    );
  }

  async previewCalculation(
    profileId: string,
    input: TaxCalculationPreviewRequest,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "tax.read", input.branchId);
    const profile = await this.prisma.taxProfile.findFirst({
      where: {
        id: profileId,
        branchId: input.branchId,
        branch: { organizationId: principal.organizationId },
      },
      include: { components: { orderBy: { calculationOrder: "asc" } } },
    });
    if (!profile) throw new NotFoundException("Tax profile not found.");
    const taxClass = await this.prisma.taxClass.findFirst({
      where: {
        id: input.taxClassId,
        branchId: input.branchId,
        branch: { organizationId: principal.organizationId },
      },
    });
    if (!taxClass) throw new NotFoundException("Tax class not found.");
    try {
      const calculation = calculateTax({
        amountMinor: input.amountMinor,
        treatment: taxClass.treatment,
        priceMode: profile.priceMode,
        roundingMode: profile.roundingMode,
        roundingScope: profile.roundingScope,
        components: profile.components,
      });
      const now = new Date();
      const effectiveNow =
        profile.status === TaxProfileStatus.ACTIVE &&
        profile.effectiveFrom <= now &&
        (!profile.effectiveTo || profile.effectiveTo > now);
      return {
        profile: {
          id: profile.id,
          key: profile.key,
          revision: profile.revision,
          status: profile.status,
          currency: profile.currency,
          effectiveFrom: profile.effectiveFrom,
          effectiveTo: profile.effectiveTo,
          effectiveNow,
        },
        taxClass: {
          id: taxClass.id,
          key: taxClass.key,
          label: taxClass.label,
          treatment: taxClass.treatment,
        },
        calculation,
        warnings: effectiveNow
          ? []
          : ["This profile is not currently effective for production sales."],
      };
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async findProfile(
    client: Prisma.TransactionClient,
    profileId: string,
    branchId: string,
    organizationId: string,
  ) {
    const profile = await client.taxProfile.findFirst({
      where: {
        id: profileId,
        branchId,
        branch: { organizationId },
      },
      include: { components: { orderBy: { calculationOrder: "asc" } } },
    });
    if (!profile) throw new NotFoundException("Tax profile not found.");
    return profile;
  }

  private assertInterval(effectiveFrom: Date, effectiveTo: Date | null) {
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException(
        "effectiveTo must be later than effectiveFrom.",
      );
    }
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) this.throwRevisionConflict();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException(
      "The tax profile changed since it was read. Refresh and retry.",
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
    entityId: string,
    eventType: string,
    response: unknown,
    reason: string,
    auditMetadata?: Prisma.InputJsonObject,
  ): TaxMutationResult {
    return {
      branchId,
      entityId,
      eventType,
      response: toJson(response),
      reason,
      auditMetadata,
    };
  }

  private publicProfile(profile: TaxProfileWithComponents) {
    return {
      id: profile.id,
      branchId: profile.branchId,
      key: profile.key,
      name: profile.name,
      status: profile.status,
      priceMode: profile.priceMode,
      roundingMode: profile.roundingMode,
      roundingScope: profile.roundingScope,
      currency: profile.currency,
      effectiveFrom: profile.effectiveFrom,
      effectiveTo: profile.effectiveTo,
      revision: profile.revision,
      approvalRecorded: Boolean(
        profile.approvalReference &&
        profile.confirmationRecordedById &&
        profile.confirmedAt,
      ),
      confirmedAt: profile.confirmedAt,
      activatedAt: profile.activatedAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      components: profile.components.map((component) => ({
        id: component.id,
        code: component.code,
        receiptLabel: component.receiptLabel,
        ratePpm: component.ratePpm,
        calculationOrder: component.calculationOrder,
        createdAt: component.createdAt,
      })),
    };
  }

  private async executeIdempotent(
    scope: string,
    idempotencyKey: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (transaction: Prisma.TransactionClient) => Promise<TaxMutationResult>,
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
              entityType: "tax_profile",
              entityId: result.entityId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                ...(result.auditMetadata ?? {}),
              },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "tax_profile",
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
          "The tax profile conflicts with an existing version or concurrent change.",
        );
      }
      throw error;
    }
  }
}
