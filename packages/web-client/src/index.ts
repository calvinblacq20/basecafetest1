import {
  loginResponseSchema,
  type LoginRequest,
  type LoginResponse,
} from "@base-cafe/contracts";

export type WebSession = LoginResponse;

export type JsonRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: HeadersInit;
  idempotencyKey?: string;
  session?: WebSession | null;
  onUnauthorized?: () => void;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

export function normalizeApiBase(value: string) {
  return value.replace(/\/+$/, "");
}

export function normalizeApiOrigin(value: string) {
  const normalized = normalizeApiBase(value);
  return normalized.endsWith("/api/v1")
    ? normalized.slice(0, -"/api/v1".length)
    : normalized;
}

export function normalizeApiV1Base(value: string) {
  return `${normalizeApiOrigin(value)}/api/v1`;
}

export function commandKey(prefix: string) {
  const normalized = prefix
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized || "command"}:${crypto.randomUUID()}`;
}

export function createSessionStore(
  namespace: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const key = `base-cafe.${namespace}.session.v1`;
  return {
    key,
    load(): WebSession | null {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = loginResponseSchema.safeParse(JSON.parse(raw));
        if (
          !parsed.success ||
          Date.parse(parsed.data.expiresAt) <= Date.now()
        ) {
          storage.removeItem(key);
          return null;
        }
        return parsed.data;
      } catch {
        storage.removeItem(key);
        return null;
      }
    },
    save(session: WebSession) {
      storage.setItem(key, JSON.stringify(loginResponseSchema.parse(session)));
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const response = await requestResponse(baseUrl, path, options);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  return payload as T;
}

export async function requestResponse(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  if (options.session)
    headers.set("authorization", `Bearer ${options.session.accessToken}`);
  if (options.idempotencyKey)
    headers.set("idempotency-key", options.idempotencyKey);

  const response = await fetch(
    `${normalizeApiBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`,
    {
      ...options,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    if (response.status === 401) options.onUnauthorized?.();
    const envelope =
      payload && typeof payload === "object"
        ? (payload as { code?: unknown; message?: unknown; details?: unknown })
        : null;
    throw new ApiError({
      status: response.status,
      code:
        typeof envelope?.code === "string"
          ? envelope.code
          : `HTTP_${response.status}`,
      message:
        typeof envelope?.message === "string"
          ? envelope.message
          : `Request failed (${response.status}).`,
      details: envelope?.details,
    });
  }

  return response;
}

export async function requestBlob(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions = {},
) {
  const response = await requestResponse(baseUrl, path, {
    ...options,
    headers: {
      ...Object.fromEntries(new Headers(options.headers).entries()),
      accept: "text/csv",
    },
  });
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
  return {
    blob: await response.blob(),
    contentType: response.headers.get("content-type"),
    filename,
  };
}

export async function loginDevice(
  baseUrl: string,
  input: LoginRequest,
): Promise<WebSession> {
  const response = await requestJson<unknown>(baseUrl, "/auth/login", {
    method: "POST",
    body: input,
  });
  return loginResponseSchema.parse(response);
}
