import type {
  LoginRequest,
  MfaActivationRequest,
  MfaDisableRequest,
  MfaEnrollmentRequest,
  MfaEnrollmentResponse,
  MfaPendingResetRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "@node-rs/argon2";
import { MfaCredentialStatus, Prisma } from "@prisma/client";

import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AuthPrincipal } from "./auth.types.js";
import {
  decryptMfaSecret,
  deterministicRecoveryCodes,
  encryptMfaSecret,
  generateTotpSecret,
  recoveryCodeHash,
  verifyTotp,
} from "./mfa-totp.js";

@Injectable()
export class MfaService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async status(principal: AuthPrincipal) {
    const credential = await this.prisma.userMfaCredential.findFirst({
      where: { userId: principal.userId },
      orderBy: { createdAt: "desc" },
      include: {
        recoveryCodes: { where: { usedAt: null }, select: { id: true } },
      },
    });
    return {
      enrollmentEnabled: process.env.MFA_ENROLLMENT_ENABLED === "true",
      enforcementEnabled: process.env.MFA_ENFORCEMENT_ENABLED === "true",
      status: credential?.status ?? "NOT_ENROLLED",
      revision: credential?.revision ?? null,
      recoveryCodesRemaining: credential?.recoveryCodes.length ?? 0,
    };
  }

  async enroll(
    input: MfaEnrollmentRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ): Promise<MfaEnrollmentResponse> {
    if (process.env.MFA_ENROLLMENT_ENABLED !== "true") {
      throw new ForbiddenException({ code: "MFA_ENROLLMENT_DISABLED" });
    }
    const scope = "auth.mfa.enroll";
    const hashValue = requestHash(input);
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (prior && prior.requestHash !== hashValue)
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });

    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
    });
    if (
      !user ||
      !(await verify(user.passwordHash, input.currentPassword).catch(
        () => false,
      ))
    )
      throw new UnauthorizedException({ code: "CURRENT_PASSWORD_INVALID" });

    const replayCredentialId = (
      prior?.responseBody as { credentialId?: string } | null
    )?.credentialId;
    let credential = replayCredentialId
      ? await this.prisma.userMfaCredential.findUnique({
          where: { id: replayCredentialId },
        })
      : await this.prisma.userMfaCredential.findFirst({
          where: {
            userId: principal.userId,
            status: { not: MfaCredentialStatus.DISABLED },
          },
          orderBy: { createdAt: "desc" },
        });
    if (
      credential &&
      credential.status === MfaCredentialStatus.ACTIVE &&
      !prior
    )
      throw new ConflictException({ code: "MFA_ALREADY_ENROLLED" });

    if (!credential) {
      const secret = generateTotpSecret();
      const codes = deterministicRecoveryCodes(secret, idempotencyKey);
      credential = await this.prisma.$transaction(async (tx) => {
        const created = await tx.userMfaCredential.create({
          data: {
            organizationId: principal.organizationId,
            userId: principal.userId,
            secretCiphertext: encryptMfaSecret(secret, process.env),
            recoveryCodes: {
              create: codes.map((code) => ({
                codeHash: recoveryCodeHash(secret, code),
              })),
            },
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: principal.organizationId,
            actorId: principal.userId,
            action: scope,
            entityType: "user-mfa-credential",
            entityId: created.id,
            reason: input.reason,
            metadata: { recoveryCodeCount: codes.length },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            actorId: principal.userId,
            scope,
            key: idempotencyKey,
            requestHash: hashValue,
            responseBody: { credentialId: created.id },
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          },
        });
        return created;
      });
    } else if (!prior) {
      throw new ConflictException({ code: "MFA_ENROLLMENT_ALREADY_PENDING" });
    }

    const secret = decryptMfaSecret(credential.secretCiphertext, process.env);
    const label = encodeURIComponent(`Base Cafe:${user.email}`);
    const issuer = encodeURIComponent("Base Cafe POS");
    return {
      status: "PENDING",
      revision: credential.revision,
      manualEntryKey: secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      recoveryCodes: deterministicRecoveryCodes(secret, idempotencyKey),
    };
  }

  async activate(
    input: MfaActivationRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    const scope = "auth.mfa.activate";
    const hashValue = requestHash(input);
    const replay = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== hashValue)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return replay.responseBody;
    }
    const credential = await this.credential(principal.userId);
    if (credential.revision !== input.revision)
      throw new ConflictException({ code: "STALE_REVISION" });
    if (credential.status !== MfaCredentialStatus.PENDING)
      throw new ConflictException({ code: "MFA_NOT_PENDING" });
    const secret = decryptMfaSecret(credential.secretCiphertext, process.env);
    if (!verifyTotp(secret, input.code))
      throw new UnauthorizedException({ code: "MFA_CODE_INVALID" });
    return this.simpleMutation(
      scope,
      credential.id,
      input,
      idempotencyKey,
      principal,
      {
        status: MfaCredentialStatus.ACTIVE,
        activatedAt: new Date(),
        revision: { increment: 1 },
      },
    );
  }

  async disable(
    input: MfaDisableRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    const scope = "auth.mfa.disable";
    const hashValue = requestHash(input);
    const replay = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== hashValue)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return replay.responseBody;
    }
    const [credential, user] = await Promise.all([
      this.credential(principal.userId),
      this.prisma.user.findUnique({ where: { id: principal.userId } }),
    ]);
    if (
      !user ||
      !(await verify(user.passwordHash, input.currentPassword).catch(
        () => false,
      ))
    )
      throw new UnauthorizedException({ code: "CURRENT_PASSWORD_INVALID" });
    if (credential.revision !== input.revision)
      throw new ConflictException({ code: "STALE_REVISION" });
    if (credential.status !== MfaCredentialStatus.ACTIVE)
      throw new ConflictException({ code: "MFA_NOT_ACTIVE" });
    const verification = await this.verifyLoginCredential(credential, input);
    if (!verification.valid)
      throw new UnauthorizedException({ code: "MFA_CODE_INVALID" });
    return this.prisma.$transaction(async (tx) => {
      if (verification.recoveryCodeId) {
        const consumed = await tx.mfaRecoveryCode.updateMany({
          where: { id: verification.recoveryCodeId, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1)
          throw new ConflictException({ code: "MFA_RECOVERY_CODE_USED" });
      }
      const updated = await tx.userMfaCredential.update({
        where: { id: credential.id },
        data: {
          status: MfaCredentialStatus.DISABLED,
          disabledAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          actorId: principal.userId,
          action: scope,
          entityType: "user-mfa-credential",
          entityId: credential.id,
          reason: input.reason,
          metadata: { verificationMethod: verification.method },
        },
      });
      await tx.idempotencyRecord.create({
        data: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
          requestHash: hashValue,
          responseBody: { disabled: true, revision: updated.revision },
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      return { disabled: true, revision: updated.revision };
    });
  }

  async resetPending(
    input: MfaPendingResetRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    const scope = "auth.mfa.reset-pending";
    const hashValue = requestHash(input);
    const replay = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== hashValue)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return replay.responseBody;
    }
    const [credential, user] = await Promise.all([
      this.credential(principal.userId),
      this.prisma.user.findUnique({ where: { id: principal.userId } }),
    ]);
    if (
      !user ||
      !(await verify(user.passwordHash, input.currentPassword).catch(
        () => false,
      ))
    )
      throw new UnauthorizedException({ code: "CURRENT_PASSWORD_INVALID" });
    if (credential.revision !== input.revision)
      throw new ConflictException({ code: "STALE_REVISION" });
    if (credential.status !== MfaCredentialStatus.PENDING)
      throw new ConflictException({ code: "MFA_NOT_PENDING" });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userMfaCredential.update({
        where: { id: credential.id },
        data: {
          status: MfaCredentialStatus.DISABLED,
          disabledAt: new Date(),
          revision: { increment: 1 },
        },
      });
      const response = { disabled: true as const, revision: updated.revision };
      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          actorId: principal.userId,
          action: scope,
          entityType: "user-mfa-credential",
          entityId: credential.id,
          reason: input.reason,
        },
      });
      await tx.idempotencyRecord.create({
        data: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
          requestHash: hashValue,
          responseBody: response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      return response;
    });
  }

  async verifyLoginCredential(
    credential: { id: string; secretCiphertext: Uint8Array },
    input:
      | Pick<LoginRequest, "mfaCode" | "mfaRecoveryCode">
      | Pick<MfaDisableRequest, "code" | "recoveryCode">,
  ) {
    const secret = decryptMfaSecret(credential.secretCiphertext, process.env);
    const values = input as {
      mfaCode?: string;
      mfaRecoveryCode?: string;
      code?: string;
      recoveryCode?: string;
    };
    const code = values.mfaCode ?? values.code;
    const recoveryCode = values.mfaRecoveryCode ?? values.recoveryCode;
    if (code && verifyTotp(secret, code))
      return { valid: true, method: "TOTP" as const };
    if (recoveryCode) {
      const row = await this.prisma.mfaRecoveryCode.findFirst({
        where: {
          credentialId: credential.id,
          codeHash: recoveryCodeHash(secret, recoveryCode),
          usedAt: null,
        },
        select: { id: true },
      });
      if (row)
        return {
          valid: true,
          method: "RECOVERY" as const,
          recoveryCodeId: row.id,
        };
    }
    return { valid: false, method: null };
  }

  private async credential(userId: string) {
    const credential = await this.prisma.userMfaCredential.findFirst({
      where: { userId, status: { not: MfaCredentialStatus.DISABLED } },
      orderBy: { createdAt: "desc" },
    });
    if (!credential) throw new NotFoundException({ code: "MFA_NOT_ENROLLED" });
    return credential;
  }

  private async simpleMutation(
    scope: string,
    credentialId: string,
    input: MfaActivationRequest,
    key: string,
    principal: AuthPrincipal,
    data: Prisma.UserMfaCredentialUpdateInput,
  ) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    const hashValue = requestHash(input);
    if (existing) {
      if (existing.requestHash !== hashValue)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userMfaCredential.update({
        where: { id: credentialId },
        data,
      });
      const response = { active: true, revision: updated.revision };
      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          actorId: principal.userId,
          action: scope,
          entityType: "user-mfa-credential",
          entityId: credentialId,
          reason: input.reason,
        },
      });
      await tx.idempotencyRecord.create({
        data: {
          actorId: principal.userId,
          scope,
          key,
          requestHash: hashValue,
          responseBody: response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      return response;
    });
  }
}
