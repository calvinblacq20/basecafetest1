import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commandKey,
  createSessionStore,
  normalizeApiOrigin,
  normalizeApiV1Base,
  requestBlob,
  requestJson,
  type WebSession,
} from "../src/index.js";

const session: WebSession = {
  accessToken: "x".repeat(32),
  expiresAt: "2099-01-01T00:00:00.000Z",
  offlineAccess: {
    enabled: false,
    leaseExpiresAt: null,
    minimumPinLength: 6,
    maximumFailedAttempts: 5,
    lockoutSeconds: 60,
  },
  scope: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    branchId: "00000000-0000-4000-8000-000000000002",
    deviceId: "00000000-0000-4000-8000-000000000003",
  },
  user: {
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Demo Operator",
    email: "operator@example.test",
    permissions: ["kds.read"],
    mustChangePassword: false,
    mfaActive: false,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("web client", () => {
  it("stores only a valid versioned session", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const store = createSessionStore("kds", storage);
    store.save(session);
    expect(store.load()?.scope.branchId).toBe(session.scope.branchId);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("adds authorization and idempotency headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await requestJson("http://localhost/api/v1/", "/resource", {
      method: "POST",
      session,
      idempotencyKey: "example:1234567890",
      body: { value: 1 },
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${session.accessToken}`);
    expect(headers.get("idempotency-key")).toBe("example:1234567890");
  });

  it("clears an expired authorization session on 401", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "SESSION_EXPIRED", message: "Expired" }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    await expect(
      requestJson("http://localhost/api/v1", "/resource", {
        session,
        onUnauthorized,
      }),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("creates bounded command keys", () => {
    expect(commandKey("KDS ticket ready")).toMatch(
      /^kds-ticket-ready:[0-9a-f-]{36}$/,
    );
  });

  it("normalizes API origins and versioned bases consistently", () => {
    expect(normalizeApiOrigin("http://localhost:3100/api/v1/")).toBe(
      "http://localhost:3100",
    );
    expect(normalizeApiV1Base("http://localhost:3100/")).toBe(
      "http://localhost:3100/api/v1",
    );
    expect(normalizeApiV1Base("http://localhost:3100/api/v1")).toBe(
      "http://localhost:3100/api/v1",
    );
  });

  it("downloads authenticated CSV and retains the server filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("a,b\r\n1,2\r\n", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="daily.csv"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestBlob(
      "http://localhost/api/v1",
      "/reports/export.csv",
      { session },
    );
    expect(result.filename).toBe("daily.csv");
    expect(await result.blob.text()).toContain("a,b\r\n");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("accept")).toBe("text/csv");
    expect(headers.get("authorization")).toBe(`Bearer ${session.accessToken}`);
  });
});
