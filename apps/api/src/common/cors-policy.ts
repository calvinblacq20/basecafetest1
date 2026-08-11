const developmentOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
] as const;

export const corsExposedHeaders = ["Content-Disposition"] as const;
export const corsAllowedHeaders = [
  "Authorization",
  "Content-Type",
  "Idempotency-Key",
  "X-Customer-Data-Reason",
] as const;

export function corsAllowedOrigins(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const configured = environment.CORS_ALLOWED_ORIGINS?.trim();
  const candidates = configured
    ? configured.split(",")
    : environment.NODE_ENV === "production"
      ? []
      : [...developmentOrigins];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("CORS_ALLOWED_ORIGINS permits only HTTP(S) origins.");
    }
    if (parsed.origin !== value.replace(/\/$/, "")) {
      throw new Error(
        "CORS_ALLOWED_ORIGINS entries must be origins without paths, queries, or fragments.",
      );
    }
    origins.add(parsed.origin);
  }
  return [...origins].sort();
}
