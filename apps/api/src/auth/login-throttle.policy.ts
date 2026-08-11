export type LoginThrottleScopeName = "ACCOUNT" | "DEVICE" | "IP";

export type LoginThrottlePolicy = Readonly<{
  windowMs: number;
  lockoutMs: number;
  failureLimits: Readonly<Record<LoginThrottleScopeName, number>>;
}>;

export type LoginThrottleState = Readonly<{
  failureCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}>;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

export function loadLoginThrottlePolicy(
  environment: NodeJS.ProcessEnv = process.env,
): LoginThrottlePolicy {
  const windowMinutes = boundedInteger(
    environment.AUTH_LOGIN_WINDOW_MINUTES,
    15,
    1,
    1_440,
  );
  const lockoutMinutes = boundedInteger(
    environment.AUTH_LOGIN_LOCKOUT_MINUTES,
    15,
    1,
    1_440,
  );
  return {
    windowMs: windowMinutes * 60_000,
    lockoutMs: lockoutMinutes * 60_000,
    failureLimits: {
      ACCOUNT: boundedInteger(
        environment.AUTH_LOGIN_ACCOUNT_MAX_FAILURES,
        5,
        2,
        100,
      ),
      DEVICE: boundedInteger(
        environment.AUTH_LOGIN_DEVICE_MAX_FAILURES,
        20,
        2,
        500,
      ),
      IP: boundedInteger(environment.AUTH_LOGIN_IP_MAX_FAILURES, 30, 2, 1_000),
    },
  };
}

export function nextLoginThrottleState(
  current: LoginThrottleState | null,
  now: Date,
  failureLimit: number,
  policy: Pick<LoginThrottlePolicy, "windowMs" | "lockoutMs">,
): LoginThrottleState {
  const currentLockActive =
    current?.lockedUntil !== null &&
    current?.lockedUntil !== undefined &&
    current.lockedUntil > now;
  if (current && currentLockActive) return current;

  const resetWindow =
    !current ||
    current.lockedUntil !== null ||
    now.getTime() - current.windowStartedAt.getTime() >= policy.windowMs;
  const failureCount = resetWindow ? 1 : current.failureCount + 1;
  return {
    failureCount,
    windowStartedAt: resetWindow ? now : current.windowStartedAt,
    lockedUntil:
      failureCount >= failureLimit
        ? new Date(now.getTime() + policy.lockoutMs)
        : null,
  };
}

export function retryAfterSeconds(lockedUntil: Date, now: Date): number {
  return Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - now.getTime()) / 1_000),
  );
}
