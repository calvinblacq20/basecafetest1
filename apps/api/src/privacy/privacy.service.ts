import type {
  ActivateRetentionPolicyRequest,
  CreateCustomerRequest,
  CreatePrivacyRequest,
  CreateRetentionPolicyRequest,
  CustomerSearchQuery,
  PrivacyRequestListQuery,
  RecordCustomerConsentRequest,
  RetentionPreviewRequest,
  TransitionPrivacyRequest,
  UpdateCustomerRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrivacyRequestStatus } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CustomerPiiCryptoService,
  type CustomerPii,
} from "./customer-pii-crypto.service.js";
import { PrivacyAccessService } from "./privacy-access.service.js";

type Tx = Prisma.TransactionClient;
type MutationResult = Readonly<{
  entityType: string;
  entityId: string;
  eventType: string;
  reason: string;
  response: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonObject;
}>;

const terminalStatuses = new Set<PrivacyRequestStatus>([
  PrivacyRequestStatus.COMPLETED,
  PrivacyRequestStatus.REJECTED,
  PrivacyRequestStatus.CANCELLED,
]);

const transitions: Readonly<
  Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]>
> = {
  RECEIVED: ["IDENTITY_VERIFIED", "REJECTED", "CANCELLED"],
  IDENTITY_VERIFIED: ["IN_PROGRESS", "REJECTED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fail(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

const consentSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  purpose: true,
  channel: true,
  status: true,
  source: true,
  wordingVersion: true,
  reason: true,
  occurredAt: true,
  recordedAt: true,
  actor: { select: { displayName: true } },
} satisfies Prisma.CustomerConsentEventSelect;
const privacyRequestSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  requestType: true,
  status: true,
  revision: true,
  dueAt: true,
  identityVerifiedAt: true,
  completedAt: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  identityVerifiedBy: { select: { displayName: true } },
  completedBy: { select: { displayName: true } },
  events: {
    select: {
      id: true,
      requestId: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      occurredAt: true,
      actor: { select: { displayName: true } },
    },
    orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.PrivacyRequestSelect;
const retentionPolicySelect = {
  id: true,
  organizationId: true,
  category: true,
  version: true,
  durationDays: true,
  status: true,
  revision: true,
  effectiveFrom: true,
  approvalReference: true,
  createdAt: true,
  activatedAt: true,
  createdBy: { select: { displayName: true } },
  activatedBy: { select: { displayName: true } },
} satisfies Prisma.RetentionPolicyVersionSelect;

type ConsentRow = Prisma.CustomerConsentEventGetPayload<{
  select: typeof consentSelect;
}>;
type PrivacyRequestRow = Prisma.PrivacyRequestGetPayload<{
  select: typeof privacyRequestSelect;
}>;
type RetentionPolicyRow = Prisma.RetentionPolicyVersionGetPayload<{
  select: typeof retentionPolicySelect;
}>;
const publicConsent = (row: ConsentRow) => {
  const { actor, ...record } = row;
  return {
    ...record,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorDisplayName: actor.displayName,
  };
};
const publicPrivacyRequest = (row: PrivacyRequestRow) => {
  const { createdBy, identityVerifiedBy, completedBy, ...record } = row;
  return {
    ...record,
    dueAt: row.dueAt?.toISOString() ?? null,
    identityVerifiedAt: row.identityVerifiedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByDisplayName: createdBy.displayName,
    identityVerifiedByDisplayName: identityVerifiedBy?.displayName ?? null,
    completedByDisplayName: completedBy?.displayName ?? null,
    events: row.events.map(({ actor, ...event }) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
      actorDisplayName: actor.displayName,
    })),
  };
};
const publicRetentionPolicy = (row: RetentionPolicyRow) => {
  const { createdBy, activatedBy, ...record } = row;
  return {
    ...record,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    createdByDisplayName: createdBy.displayName,
    activatedByDisplayName: activatedBy?.displayName ?? null,
  };
};

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CustomerPiiCryptoService)
    private readonly crypto: CustomerPiiCryptoService,
    @Inject(PrivacyAccessService)
    private readonly access: PrivacyAccessService,
  ) {}

  async createCustomer(
    input: CreateCustomerRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customers.create");
    return this.mutate(
      "customers.create",
      key,
      input,
      principal,
      async (tx) => {
        const pii = this.piiFromInput(input);
        const envelope = this.crypto.protect(pii, {
          organizationId: principal.organizationId,
          resourceType: "customer-profile",
          resourceId: input.customerId,
        });
        if (!envelope)
          fail("CUSTOMER_IDENTITY_REQUIRED", "Customer identity is required.");
        const duplicateCount = await tx.customerProfile.count({
          where: {
            organizationId: principal.organizationId,
            status: { not: "ANONYMIZED" },
            OR: [
              ...(input.phone
                ? [
                    {
                      phoneBlindIndex: this.crypto.phoneBlindIndex(
                        input.phone,
                      )!,
                    },
                  ]
                : []),
              ...(input.email
                ? [
                    {
                      emailBlindIndex: this.crypto.emailBlindIndex(
                        input.email,
                      )!,
                    },
                  ]
                : []),
            ],
          },
        });
        const customer = await tx.customerProfile.create({
          data: {
            id: input.customerId,
            organizationId: principal.organizationId,
            piiCiphertext: envelope.ciphertext,
            piiIv: envelope.iv,
            piiAuthTag: envelope.authTag,
            piiKeyVersion: envelope.keyVersion,
            phoneBlindIndex: this.crypto.phoneBlindIndex(input.phone),
            emailBlindIndex: this.crypto.emailBlindIndex(input.email),
            legalHoldUntil: input.legalHoldUntil
              ? new Date(input.legalHoldUntil)
              : null,
            createdById: principal.userId,
          },
        });
        const response = {
          id: customer.id,
          organizationId: customer.organizationId,
          status: customer.status,
          revision: customer.revision,
          createdAt: customer.createdAt.toISOString(),
          updatedAt: customer.updatedAt.toISOString(),
          duplicateWarning: duplicateCount > 0,
        };
        return {
          entityType: "customer_profile",
          entityId: customer.id,
          eventType: "customer.created",
          reason: input.reason,
          response: json(response),
          metadata: { duplicateWarning: duplicateCount > 0 },
        };
      },
    );
  }

  async getCustomer(
    customerId: string,
    reason: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customers.read");
    this.permission(principal, "customers.pii.read");
    const customer = await this.findCustomer(
      this.prisma,
      customerId,
      principal,
    );
    const pii = this.decryptCustomer(customer, principal.organizationId);
    await this.access.record(principal, {
      accessType: "VIEW",
      resourceType: "CUSTOMER_PROFILE",
      resourceId: customer.id,
      customerId: customer.id,
      fields: this.presentFields(pii),
      reason,
    });
    return this.customerResponse(customer, pii);
  }

  async search(
    query: CustomerSearchQuery,
    reason: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customers.read");
    this.permission(principal, "customers.pii.read");
    const customers = await this.prisma.customerProfile.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(query.phone && {
          phoneBlindIndex: this.crypto.phoneBlindIndex(query.phone),
        }),
        ...(query.email && {
          emailBlindIndex: this.crypto.emailBlindIndex(query.email),
        }),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    await this.access.record(principal, {
      accessType: "SEARCH",
      resourceType: "CUSTOMER_PROFILE_SEARCH",
      resourceId: "exact-match",
      fields: [query.phone ? "phone" : "", query.email ? "email" : ""].filter(
        Boolean,
      ),
      reason,
    });
    return {
      items: customers.map((customer) =>
        this.customerResponse(
          customer,
          this.decryptCustomer(customer, principal.organizationId),
        ),
      ),
    };
  }

  async updateCustomer(
    customerId: string,
    input: UpdateCustomerRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customers.manage");
    return this.mutate(
      "customers.update",
      key,
      { customerId, ...input },
      principal,
      async (tx) => {
        const existing = await this.findCustomer(tx, customerId, principal);
        if (existing.status === "ANONYMIZED")
          fail(
            "CUSTOMER_ANONYMIZED",
            "An anonymized profile cannot be restored.",
          );
        if (existing.revision !== input.revision)
          fail("STALE_REVISION", "The customer changed.");
        const current = this.decryptCustomer(
          existing,
          principal.organizationId,
        );
        const pii: CustomerPii = {
          ...current,
          ...Object.fromEntries(
            Object.entries(this.piiFromInput(input)).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        };
        if (!pii.displayName && !pii.phone && !pii.email)
          fail(
            "CUSTOMER_IDENTITY_REQUIRED",
            "A name, phone, or email is required.",
          );
        const envelope = this.crypto.protect(pii, {
          organizationId: principal.organizationId,
          resourceType: "customer-profile",
          resourceId: customerId,
        });
        if (!envelope)
          fail("CUSTOMER_IDENTITY_REQUIRED", "Customer identity is required.");
        const customer = await tx.customerProfile.update({
          where: { id: customerId, revision: input.revision },
          data: {
            revision: { increment: 1 },
            piiCiphertext: envelope.ciphertext,
            piiIv: envelope.iv,
            piiAuthTag: envelope.authTag,
            piiKeyVersion: envelope.keyVersion,
            phoneBlindIndex: this.crypto.phoneBlindIndex(pii.phone),
            emailBlindIndex: this.crypto.emailBlindIndex(pii.email),
            ...(input.legalHoldUntil !== undefined && {
              legalHoldUntil: input.legalHoldUntil
                ? new Date(input.legalHoldUntil)
                : null,
            }),
          },
        });
        return {
          entityType: "customer_profile",
          entityId: customerId,
          eventType: "customer.updated",
          reason: input.reason,
          response: json({
            id: customer.id,
            organizationId: customer.organizationId,
            status: customer.status,
            revision: customer.revision,
            updatedAt: customer.updatedAt.toISOString(),
          }),
        };
      },
    );
  }

  async exportCustomer(
    customerId: string,
    reason: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customer-data.export");
    this.permission(principal, "customers.pii.read");
    const customer = await this.findCustomer(
      this.prisma,
      customerId,
      principal,
    );
    const pii = this.decryptCustomer(customer, principal.organizationId);
    const [consents, requests] = await Promise.all([
      this.prisma.customerConsentEvent.findMany({
        where: { organizationId: principal.organizationId, customerId },
        select: consentSelect,
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.privacyRequest.findMany({
        where: { organizationId: principal.organizationId, customerId },
        select: privacyRequestSelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    await this.access.record(principal, {
      accessType: "EXPORT",
      resourceType: "CUSTOMER_EXPORT",
      resourceId: customerId,
      customerId,
      fields: [...this.presentFields(pii), "consents", "privacyRequests"],
      reason,
    });
    return {
      generatedAt: new Date().toISOString(),
      customer: this.customerResponse(customer, pii),
      consents: consents.map(publicConsent),
      privacyRequests: requests.map(publicPrivacyRequest),
    };
  }

  async recordConsent(
    customerId: string,
    input: RecordCustomerConsentRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "customers.manage");
    if (
      input.purpose === "MARKETING" &&
      input.status === "GRANTED" &&
      process.env.PRIVACY_MARKETING_ENABLED !== "true"
    )
      fail(
        "MARKETING_CONSENT_NOT_ENABLED",
        "Marketing consent grants remain disabled pending owner policy confirmation.",
      );
    return this.mutate(
      "customers.consent.record",
      key,
      { customerId, ...input },
      principal,
      async (tx) => {
        const customer = await this.findCustomer(tx, customerId, principal);
        if (customer.status === "ANONYMIZED")
          fail(
            "CUSTOMER_ANONYMIZED",
            "Consent cannot be attached to an anonymized profile.",
          );
        const event = await tx.customerConsentEvent.create({
          data: {
            id: input.eventId,
            organizationId: principal.organizationId,
            customerId,
            purpose: input.purpose,
            channel: input.channel,
            status: input.status,
            source: input.source,
            wordingVersion: input.wordingVersion,
            occurredAt: new Date(input.occurredAt),
            actorId: principal.userId,
            reason: input.reason,
          },
          select: consentSelect,
        });
        return {
          entityType: "customer_consent_event",
          entityId: event.id,
          eventType: "customer.consent.recorded",
          reason: input.reason,
          response: json(publicConsent(event)),
          metadata: {
            customerId,
            purpose: input.purpose,
            status: input.status,
          },
        };
      },
    );
  }

  async listConsents(customerId: string, principal: AuthPrincipal) {
    this.permission(principal, "customers.read");
    await this.findCustomer(this.prisma, customerId, principal);
    const rows = await this.prisma.customerConsentEvent.findMany({
      where: { organizationId: principal.organizationId, customerId },
      select: consentSelect,
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    });
    return rows.map(publicConsent);
  }

  async createPrivacyRequest(
    customerId: string,
    input: CreatePrivacyRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.requests.manage");
    return this.mutate(
      "privacy.requests.create",
      key,
      { customerId, ...input },
      principal,
      async (tx) => {
        await this.findCustomer(tx, customerId, principal);
        const request = await tx.privacyRequest.create({
          data: {
            id: input.requestId,
            organizationId: principal.organizationId,
            customerId,
            requestType: input.requestType,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            createdById: principal.userId,
            reason: input.reason,
            events: {
              create: {
                fromStatus: null,
                toStatus: "RECEIVED",
                actorId: principal.userId,
                reason: input.reason,
              },
            },
          },
          select: privacyRequestSelect,
        });
        return {
          entityType: "privacy_request",
          entityId: request.id,
          eventType: "privacy.request.created",
          reason: input.reason,
          response: json(publicPrivacyRequest(request)),
          metadata: { customerId, requestType: input.requestType },
        };
      },
    );
  }

  async listPrivacyRequests(
    query: PrivacyRequestListQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.requests.read");
    const rows = await this.prisma.privacyRequest.findMany({
      where: {
        organizationId: principal.organizationId,
        status: query.status,
        requestType: query.requestType,
      },
      select: privacyRequestSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return rows.map(publicPrivacyRequest);
  }

  async transitionPrivacyRequest(
    requestId: string,
    input: TransitionPrivacyRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.requests.manage");
    return this.mutate(
      "privacy.requests.transition",
      key,
      { requestId, ...input },
      principal,
      async (tx) => {
        const request = await tx.privacyRequest.findFirst({
          where: { id: requestId, organizationId: principal.organizationId },
        });
        if (!request)
          throw new NotFoundException({ code: "PRIVACY_REQUEST_NOT_FOUND" });
        if (request.revision !== input.revision)
          fail("STALE_REVISION", "The request changed.");
        if (!transitions[request.status].includes(input.status))
          fail(
            "PRIVACY_REQUEST_TRANSITION_INVALID",
            "That request transition is not allowed.",
          );
        const customer = await this.findCustomer(
          tx,
          request.customerId,
          principal,
        );
        if (
          input.status === "COMPLETED" &&
          request.requestType === "ANONYMIZATION"
        ) {
          if (process.env.PRIVACY_ANONYMIZATION_ENABLED !== "true")
            fail(
              "CUSTOMER_ANONYMIZATION_NOT_ENABLED",
              "Anonymization is disabled pending approved policy.",
            );
          if (customer.legalHoldUntil && customer.legalHoldUntil > new Date())
            fail(
              "CUSTOMER_LEGAL_HOLD_ACTIVE",
              "The customer is subject to an active legal hold.",
            );
          await tx.orderCustomerContact.updateMany({
            where: {
              organizationId: principal.organizationId,
              customerId: customer.id,
            },
            data: {
              piiCiphertext: null,
              piiIv: null,
              piiAuthTag: null,
              piiKeyVersion: null,
              phoneBlindIndex: null,
              anonymizedAt: new Date(),
            },
          });
          await tx.customerProfile.update({
            where: { id: customer.id },
            data: {
              status: "ANONYMIZED",
              revision: { increment: 1 },
              piiCiphertext: null,
              piiIv: null,
              piiAuthTag: null,
              piiKeyVersion: null,
              phoneBlindIndex: null,
              emailBlindIndex: null,
              anonymizedById: principal.userId,
              anonymizedAt: new Date(),
            },
          });
        } else if (
          input.status === "COMPLETED" &&
          request.requestType === "RESTRICTION"
        ) {
          await tx.customerProfile.update({
            where: { id: customer.id },
            data: { status: "RESTRICTED", revision: { increment: 1 } },
          });
        }
        const now = new Date();
        const terminal = terminalStatuses.has(input.status);
        const updated = await tx.privacyRequest.update({
          where: { id: requestId, revision: input.revision },
          data: {
            status: input.status,
            revision: { increment: 1 },
            ...(input.status === "IDENTITY_VERIFIED" && {
              identityVerifiedById: principal.userId,
              identityVerifiedAt: now,
            }),
            ...(terminal && {
              completedById: principal.userId,
              completedAt: now,
            }),
            events: {
              create: {
                fromStatus: request.status,
                toStatus: input.status,
                actorId: principal.userId,
                reason: input.reason,
              },
            },
          },
          select: privacyRequestSelect,
        });
        return {
          entityType: "privacy_request",
          entityId: requestId,
          eventType: "privacy.request.transitioned",
          reason: input.reason,
          response: json(publicPrivacyRequest(updated)),
          metadata: { fromStatus: request.status, toStatus: input.status },
        };
      },
    );
  }

  async createRetentionPolicy(
    input: CreateRetentionPolicyRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.policies.manage");
    return this.mutate(
      "privacy.retention.create",
      key,
      input,
      principal,
      async (tx) => {
        const policy = await tx.retentionPolicyVersion.create({
          data: {
            id: input.policyId,
            organizationId: principal.organizationId,
            category: input.category,
            version: input.version,
            durationDays: input.durationDays,
            createdById: principal.userId,
          },
          select: retentionPolicySelect,
        });
        return {
          entityType: "retention_policy_version",
          entityId: policy.id,
          eventType: "privacy.retention.drafted",
          reason: input.reason,
          response: json(publicRetentionPolicy(policy)),
        };
      },
    );
  }

  async listRetentionPolicies(principal: AuthPrincipal) {
    this.permission(principal, "privacy.policies.read");
    const rows = await this.prisma.retentionPolicyVersion.findMany({
      where: { organizationId: principal.organizationId },
      select: retentionPolicySelect,
      orderBy: [{ category: "asc" }, { version: "desc" }, { id: "asc" }],
    });
    return rows.map(publicRetentionPolicy);
  }

  async activateRetentionPolicy(
    policyId: string,
    input: ActivateRetentionPolicyRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.policies.manage");
    if (process.env.PRIVACY_RETENTION_ACTIVATION_ENABLED !== "true")
      fail(
        "RETENTION_ACTIVATION_NOT_ENABLED",
        "Retention activation awaits approved policy.",
      );
    return this.mutate(
      "privacy.retention.activate",
      key,
      { policyId, ...input },
      principal,
      async (tx) => {
        const policy = await tx.retentionPolicyVersion.findFirst({
          where: { id: policyId, organizationId: principal.organizationId },
        });
        if (!policy)
          throw new NotFoundException({ code: "RETENTION_POLICY_NOT_FOUND" });
        if (policy.status !== "DRAFT")
          fail("RETENTION_POLICY_NOT_DRAFT", "Only drafts can be activated.");
        if (policy.revision !== input.revision)
          fail("STALE_REVISION", "The policy changed.");
        const updated = await tx.retentionPolicyVersion.update({
          where: { id: policyId, revision: input.revision },
          data: {
            status: "ACTIVE",
            revision: { increment: 1 },
            effectiveFrom: new Date(input.effectiveFrom),
            approvalReference: input.approvalReference,
            activatedById: principal.userId,
            activatedAt: new Date(),
          },
          select: retentionPolicySelect,
        });
        return {
          entityType: "retention_policy_version",
          entityId: policyId,
          eventType: "privacy.retention.activated",
          reason: input.reason,
          response: json(publicRetentionPolicy(updated)),
        };
      },
    );
  }

  async retentionPreview(
    input: RetentionPreviewRequest,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "privacy.policies.read");
    const policy = await this.prisma.retentionPolicyVersion.findFirst({
      where: { id: input.policyId, organizationId: principal.organizationId },
    });
    if (!policy)
      throw new NotFoundException({ code: "RETENTION_POLICY_NOT_FOUND" });
    const asOf = new Date(input.asOf);
    const cutoff = new Date(asOf.getTime() - policy.durationDays * 86_400_000);
    let candidateCount = 0;
    const issues: string[] = [];
    if (policy.category === "CUSTOMER_PROFILE") {
      candidateCount = await this.prisma.customerProfile.count({
        where: {
          organizationId: principal.organizationId,
          status: { not: "ANONYMIZED" },
          updatedAt: { lte: cutoff },
          OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lt: asOf } }],
        },
      });
    } else if (policy.category === "ORDER_CONTACT") {
      candidateCount = await this.prisma.orderCustomerContact.count({
        where: {
          organizationId: principal.organizationId,
          anonymizedAt: null,
          createdAt: { lte: cutoff },
        },
      });
    } else {
      issues.push("FIELD_LEVEL_RETENTION_UNAVAILABLE");
    }
    await this.prisma.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        actorId: principal.userId,
        action: "privacy.retention.preview",
        entityType: "retention_policy_version",
        entityId: policy.id,
        reason: input.reason,
        metadata: {
          category: policy.category,
          asOf: input.asOf,
          candidateCount,
          issues,
        },
      },
    });
    return {
      generatedAt: new Date().toISOString(),
      policyId: policy.id,
      category: policy.category,
      asOf: asOf.toISOString(),
      cutoff: cutoff.toISOString(),
      candidateCount,
      issues,
      executionEnabled: false,
    };
  }

  private piiFromInput(
    input: Partial<CreateCustomerRequest | UpdateCustomerRequest>,
  ): CustomerPii {
    return {
      displayName: input.displayName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      preferredContactChannel: input.preferredContactChannel,
    };
  }

  private decryptCustomer(
    customer: {
      id: string;
      piiCiphertext: Uint8Array<ArrayBufferLike> | null;
      piiIv: Uint8Array<ArrayBufferLike> | null;
      piiAuthTag: Uint8Array<ArrayBufferLike> | null;
      piiKeyVersion: string | null;
      status: string;
    },
    organizationId: string,
  ): CustomerPii {
    if (customer.status === "ANONYMIZED") return {};
    if (
      !customer.piiCiphertext ||
      !customer.piiIv ||
      !customer.piiAuthTag ||
      !customer.piiKeyVersion
    )
      fail(
        "CUSTOMER_PII_INCOMPLETE",
        "The customer encryption envelope is incomplete.",
      );
    return this.crypto.unprotect(
      {
        ciphertext: Buffer.from(customer.piiCiphertext),
        iv: Buffer.from(customer.piiIv),
        authTag: Buffer.from(customer.piiAuthTag),
        keyVersion: customer.piiKeyVersion,
      },
      {
        organizationId,
        resourceType: "customer-profile",
        resourceId: customer.id,
      },
    );
  }

  private customerResponse(
    customer: {
      id: string;
      organizationId: string;
      status: string;
      revision: number;
      legalHoldUntil: Date | null;
      createdAt: Date;
      updatedAt: Date;
      anonymizedAt: Date | null;
    },
    pii: CustomerPii,
  ) {
    return {
      id: customer.id,
      organizationId: customer.organizationId,
      status: customer.status,
      revision: customer.revision,
      displayName: pii.displayName ?? null,
      phone: pii.phone ?? null,
      email: pii.email ?? null,
      notes: pii.notes ?? null,
      preferredContactChannel: pii.preferredContactChannel ?? null,
      legalHoldUntil: customer.legalHoldUntil?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      anonymizedAt: customer.anonymizedAt?.toISOString() ?? null,
    };
  }

  private presentFields(pii: CustomerPii) {
    return Object.entries(pii)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([field]) => field)
      .sort();
  }

  private async findCustomer(
    client: PrismaService | Tx,
    id: string,
    principal: AuthPrincipal,
  ) {
    const customer = await client.customerProfile.findFirst({
      where: { id, organizationId: principal.organizationId },
    });
    if (!customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
    return customer;
  }

  private permission(principal: AuthPrincipal, permission: string) {
    if (!hasPermission(principal, permission))
      throw new ForbiddenException({ code: "PERMISSION_DENIED", permission });
  }

  private async mutate(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<MutationResult>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        fail("IDEMPOTENCY_KEY_CONFLICT", "The key was reused.");
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await work(tx);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
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
          await tx.outboxEvent.create({
            data: {
              aggregateType: result.entityType,
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                entityId: result.entityId,
              },
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hash,
              responseBody: result.response,
              expiresAt: new Date(Date.now() + 86_400_000),
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
      )
        fail(
          "PRIVACY_RESOURCE_CONFLICT",
          "That privacy resource or version already exists.",
        );
      throw error;
    }
  }
}
