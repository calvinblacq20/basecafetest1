import type { PilotEvidenceCode } from "@base-cafe/contracts";

export type PilotReadinessCheck = Readonly<{
  code: string;
  category: "AUTOMATED" | "EVIDENCE";
  status: "PASS" | "BLOCKED" | "UNCONFIRMED";
  summary: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
  evidenceId?: string | null;
  observedAt?: string | null;
}>;

export const requiredPilotEvidence: ReadonlyArray<{
  code: PilotEvidenceCode;
  summary: string;
}> = [
  { code: "OWNER_SCOPE_APPROVED", summary: "Owner approved the pilot scope." },
  {
    code: "ACCOUNTANT_TAX_APPROVED",
    summary: "Accountant approved tax and calculation configuration.",
  },
  {
    code: "PAYMENT_PROCESS_APPROVED",
    summary: "Launch payment process and settlement controls were approved.",
  },
  {
    code: "FISCAL_PROCESS_APPROVED",
    summary:
      "Applicable GRA/fiscal process or documented non-applicability was approved.",
  },
  {
    code: "PRIVACY_APPROVED",
    summary: "Privacy and retention governance was approved.",
  },
  {
    code: "HARDWARE_SITE_TESTED",
    summary: "Selected site hardware and network were tested.",
  },
  {
    code: "PRINTER_FLOW_TESTED",
    summary: "Receipt and preparation printing flow was tested.",
  },
  {
    code: "OFFLINE_DRILL_PASSED",
    summary: "Offline, restart, and reconnect drill passed.",
  },
  {
    code: "RECONCILIATION_PASSED",
    summary: "A complete staging or pilot day reconciled.",
  },
  {
    code: "TRAINING_COMPLETED",
    summary: "Required staff training was completed.",
  },
  {
    code: "ROLLBACK_APPROVED",
    summary: "Rollback, fallback, and reconciliation plan was approved.",
  },
  {
    code: "INCIDENT_CONTACTS_APPROVED",
    summary: "Incident contacts and escalation authority were approved.",
  },
  {
    code: "OWNER_PILOT_SIGNOFF",
    summary: "Owner recorded controlled-pilot acceptance.",
  },
];

export function deploymentPreflight(
  environment: Readonly<Record<string, string | undefined>>,
): PilotReadinessCheck {
  const applicationVersion = environment.APP_VERSION?.trim();
  const databaseUrl = environment.DATABASE_URL?.trim() ?? "";
  const activePiiVersion = environment.CUSTOMER_PII_ACTIVE_KEY_VERSION?.trim();
  let piiVersionAvailable = false;
  try {
    const keyRing = JSON.parse(
      environment.CUSTOMER_PII_KEYS_JSON ?? "{}",
    ) as Record<string, unknown>;
    piiVersionAvailable = Boolean(
      activePiiVersion && typeof keyRing[activePiiVersion] === "string",
    );
  } catch {
    piiVersionAvailable = false;
  }
  const details = {
    productionMode: environment.NODE_ENV === "production",
    versionPinned: Boolean(
      applicationVersion && applicationVersion !== "0.1.0",
    ),
    databaseConfigured:
      databaseUrl.startsWith("postgresql://") &&
      !/(localhost|127\.0\.0\.1)/i.test(databaseUrl) &&
      /[?&](sslmode=(require|verify-ca|verify-full)|ssl=true)(&|$)/i.test(
        databaseUrl,
      ),
    throttlePepperConfigured:
      (environment.AUTH_THROTTLE_PEPPER?.trim().length ?? 0) >= 32,
    customerEncryptionConfigured:
      piiVersionAvailable &&
      Boolean(environment.CUSTOMER_PII_BLIND_INDEX_KEY_B64?.trim()),
    backupRuntimeConfigured:
      environment.BACKUP_ENABLED === "true" &&
      Boolean(environment.BACKUP_DIRECTORY?.trim()) &&
      Boolean(environment.BACKUP_ENCRYPTION_KEY_B64?.trim()) &&
      Boolean(environment.BACKUP_RETENTION_DAYS?.trim()),
    bootstrapCredentialsRemoved:
      !environment.BOOTSTRAP_ADMIN_EMAIL?.trim() &&
      !environment.BOOTSTRAP_ADMIN_PASSWORD?.trim(),
    publicApiUsesHttps:
      environment.NEXT_PUBLIC_API_BASE_URL?.trim().startsWith("https://") ??
      false,
  };
  return {
    code: "DEPLOYMENT_ENVIRONMENT",
    category: "AUTOMATED",
    status: Object.values(details).every(Boolean) ? "PASS" : "BLOCKED",
    summary: "Production runtime configuration is explicit and secret-safe.",
    details,
  };
}

export function readinessResult(
  organizationId: string,
  generatedAt: Date,
  automatedChecks: readonly PilotReadinessCheck[],
  latestEvidence: ReadonlyMap<
    PilotEvidenceCode,
    {
      id: string;
      outcome: string;
      observedAt: Date;
    }
  >,
) {
  const evidenceChecks: PilotReadinessCheck[] = requiredPilotEvidence.map(
    ({ code, summary }) => {
      const evidence = latestEvidence.get(code);
      if (!evidence)
        return {
          code,
          category: "EVIDENCE",
          status: "UNCONFIRMED",
          summary,
          evidenceId: null,
          observedAt: null,
        };
      return {
        code,
        category: "EVIDENCE",
        status: evidence.outcome === "CONFIRMED" ? "PASS" : "BLOCKED",
        summary,
        evidenceId: evidence.id,
        observedAt: evidence.observedAt.toISOString(),
      };
    },
  );
  const checks = [...automatedChecks, ...evidenceChecks];
  const blockedCount = checks.filter(
    ({ status }) => status === "BLOCKED",
  ).length;
  const unconfirmedCount = checks.filter(
    ({ status }) => status === "UNCONFIRMED",
  ).length;
  const passedCount = checks.filter(({ status }) => status === "PASS").length;
  const status = blockedCount
    ? "BLOCKED"
    : unconfirmedCount
      ? "UNCONFIRMED"
      : "READY";
  return {
    organizationId,
    generatedAt: generatedAt.toISOString(),
    basis: "LIVE_CONFIGURATION_AND_LATEST_EVIDENCE",
    status,
    counts: {
      blocked: blockedCount,
      unconfirmed: unconfirmedCount,
      passed: passedCount,
    },
    blockingCodes: checks
      .filter(({ status }) => status === "BLOCKED")
      .map(({ code }) => code),
    unconfirmedCodes: checks
      .filter(({ status }) => status === "UNCONFIRMED")
      .map(({ code }) => code),
    checks,
  };
}
