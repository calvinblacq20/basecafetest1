export type RuntimeEnvironmentIssue = {
  code: string;
  variable: string;
  message: string;
};

const enabled = (value: string | undefined) => value === "true";

function isPostgresUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validOriginList(value: string | undefined) {
  if (!value?.trim()) return false;
  return value.split(",").every((candidate) => {
    try {
      const parsed = new URL(candidate.trim());
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.origin === candidate.trim() &&
        !parsed.username &&
        !parsed.password
      );
    } catch {
      return false;
    }
  });
}

export function runtimeEnvironmentIssues(
  environment: NodeJS.ProcessEnv,
): RuntimeEnvironmentIssue[] {
  const issues: RuntimeEnvironmentIssue[] = [];
  const production = environment.NODE_ENV === "production";
  const add = (code: string, variable: string, message: string) =>
    issues.push({ code, variable, message });

  if (!isPostgresUrl(environment.DATABASE_URL)) {
    add(
      "DATABASE_URL_INVALID",
      "DATABASE_URL",
      "A PostgreSQL connection URL is required.",
    );
  }

  const port = Number(environment.PORT ?? "3100");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    add("PORT_INVALID", "PORT", "PORT must be an integer from 1 to 65535.");
  }

  if (environment.TRUST_PROXY_HOPS) {
    const hops = Number(environment.TRUST_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
      add(
        "TRUST_PROXY_HOPS_INVALID",
        "TRUST_PROXY_HOPS",
        "TRUST_PROXY_HOPS must be an integer from 0 to 10.",
      );
    }
  }

  if (production) {
    if (!validOriginList(environment.CORS_ALLOWED_ORIGINS)) {
      add(
        "CORS_ALLOWED_ORIGINS_INVALID",
        "CORS_ALLOWED_ORIGINS",
        "Production requires an explicit comma-separated list of exact HTTP(S) origins.",
      );
    }
    if ((environment.AUTH_THROTTLE_PEPPER?.trim().length ?? 0) < 32) {
      add(
        "AUTH_THROTTLE_PEPPER_MISSING",
        "AUTH_THROTTLE_PEPPER",
        "Production requires a unique secret of at least 32 characters.",
      );
    }
    if (environment.BOOTSTRAP_ADMIN_PASSWORD?.trim()) {
      add(
        "BOOTSTRAP_SECRET_PRESENT",
        "BOOTSTRAP_ADMIN_PASSWORD",
        "Bootstrap credentials must be removed after provisioning.",
      );
    }
  }

  if (
    enabled(environment.PRIVACY_RETENTION_ACTIVATION_ENABLED) &&
    !enabled(environment.PRIVACY_ANONYMIZATION_ENABLED)
  ) {
    add(
      "RETENTION_EXECUTION_INCOMPLETE",
      "PRIVACY_ANONYMIZATION_ENABLED",
      "Retention activation cannot be enabled without the approved anonymization executor.",
    );
  }

  if (enabled(environment.MFA_ENROLLMENT_ENABLED)) {
    const encodedKey = environment.MFA_ENCRYPTION_KEY_B64?.trim();
    let decodedLength = 0;
    try {
      decodedLength = encodedKey ? Buffer.from(encodedKey, "base64").length : 0;
    } catch {
      decodedLength = 0;
    }
    if (decodedLength !== 32) {
      add(
        "MFA_KEY_INVALID",
        "MFA_ENCRYPTION_KEY_B64",
        "MFA enrollment requires a secret-management supplied 32-byte base64 encryption key.",
      );
    }
  }

  if (enabled(environment.MFA_ENFORCEMENT_ENABLED)) {
    if (!enabled(environment.MFA_ENROLLMENT_ENABLED)) {
      add(
        "MFA_ENFORCEMENT_UNAVAILABLE",
        "MFA_ENROLLMENT_ENABLED",
        "MFA enforcement requires enrollment to be enabled first.",
      );
    }
  }

  const adapters = [
    [
      "PSP_ADAPTER",
      environment.PSP_ADAPTER ?? "disabled",
      ["disabled", "fictional-test"],
      ["disabled"],
    ],
    [
      "GRA_FISCAL_ADAPTER",
      environment.GRA_FISCAL_ADAPTER ?? "disabled",
      ["disabled", "fictional-test"],
      ["disabled"],
    ],
    [
      "PRINTER_ADAPTER",
      environment.PRINTER_ADAPTER ?? "browser",
      ["disabled", "browser", "fictional-test"],
      ["disabled", "browser"],
    ],
    [
      "NOTIFICATION_ADAPTER",
      environment.NOTIFICATION_ADAPTER ?? "disabled",
      ["disabled", "fictional-test"],
      ["disabled"],
    ],
  ] as const;
  for (const [
    variable,
    selected,
    supportedModes,
    productionModes,
  ] of adapters) {
    if (!(supportedModes as readonly string[]).includes(selected)) {
      add(
        "ADAPTER_MODE_INVALID",
        variable,
        `${variable} has an unsupported adapter mode.`,
      );
    } else if (
      production &&
      !(productionModes as readonly string[]).includes(selected)
    ) {
      add(
        "ADAPTER_NOT_PRODUCTION_APPROVED",
        variable,
        `${variable} is not an approved production adapter.`,
      );
    } else if (
      selected === "fictional-test" &&
      !enabled(environment.ALLOW_FICTIONAL_INTEGRATION_ADAPTERS)
    ) {
      add(
        "FICTIONAL_ADAPTERS_DISABLED",
        variable,
        "Fictional adapters require the explicit development/test opt-in.",
      );
    }
  }

  return issues.sort((left, right) =>
    `${left.variable}:${left.code}`.localeCompare(
      `${right.variable}:${right.code}`,
    ),
  );
}

export function runtimePosture(environment: NodeJS.ProcessEnv) {
  return {
    event: "runtime.posture",
    version: environment.APP_VERSION ?? "0.1.0",
    environment: environment.NODE_ENV ?? "development",
    mfaEnrollment: enabled(environment.MFA_ENROLLMENT_ENABLED),
    mfaEnforcement: enabled(environment.MFA_ENFORCEMENT_ENABLED),
    privacyRetentionExecution: enabled(
      environment.PRIVACY_RETENTION_ACTIVATION_ENABLED,
    ),
    adapters: {
      psp: environment.PSP_ADAPTER ?? "disabled",
      graFiscal: environment.GRA_FISCAL_ADAPTER ?? "disabled",
      printer: environment.PRINTER_ADAPTER ?? "browser",
      notification: environment.NOTIFICATION_ADAPTER ?? "disabled",
    },
  } as const;
}

export function assertRuntimeEnvironment(environment: NodeJS.ProcessEnv) {
  const issues = runtimeEnvironmentIssues(environment);
  if (issues.length) {
    throw new Error(
      `RUNTIME_ENVIRONMENT_INVALID\n${issues
        .map((issue) => `${issue.variable}: ${issue.message} [${issue.code}]`)
        .join("\n")}`,
    );
  }
}
