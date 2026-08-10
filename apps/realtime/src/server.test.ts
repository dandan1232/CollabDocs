import { describe, expect, it, vi } from "vitest";

import {
  authorizeConnection,
  checkRealtimeReadiness,
  createHealthPayload,
  loadDocumentState,
} from "./server.js";

describe("realtime health payload", () => {
  it("identifies the service as healthy", () => {
    expect(createHealthPayload()).toEqual({
      service: "collabdocs-realtime",
      status: "ok",
    });
  });
});

describe("realtime authorization", () => {
  it("returns the scoped user from the web authorization service", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          user: {
            id: "guest-1",
            nickname: "松墨",
            avatarUrl: "/api/avatars/seed",
            presenceColor: "#586B4C",
            readOnly: false,
          },
        }),
        { status: 200 },
      );

    await expect(
      authorizeConnection(
        "http://web:3000",
        "signed-token",
        "018f5f70-2f55-7ee3-8f21-118cb0bb3c50",
        fetcher as typeof fetch,
      ),
    ).resolves.toMatchObject({
      user: { nickname: "松墨", readOnly: false },
    });
  });

  it("rejects invalid document identifiers before calling the web service", async () => {
    const fetcher = async () => new Response(null, { status: 200 });

    await expect(
      authorizeConnection(
        "http://web:3000",
        "signed-token",
        "not-a-document-id",
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("authorization rejected");
  });
});

describe("realtime persistence", () => {
  it("leaves a new room empty when no persisted Yjs update exists", async () => {
    const persistence = {
      check: async () => undefined,
      load: async () => null,
      store: async () => undefined,
    };

    await expect(loadDocumentState(persistence, "new-document")).resolves.toBe(
      undefined,
    );
  });
});

describe("realtime readiness", () => {
  it("checks PostgreSQL and the internal web service", async () => {
    const persistence = {
      check: vi.fn().mockResolvedValue(undefined),
      load: async () => null,
      store: async () => undefined,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      checkRealtimeReadiness(
        persistence,
        "http://web:3000",
        fetcher as typeof fetch,
      ),
    ).resolves.toEqual({
      service: "collabdocs-realtime",
      status: "ok",
      checks: { database: "ok", web: "ok" },
    });
    expect(persistence.check).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://web:3000/api/health/ready"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects when the web service is not ready", async () => {
    const persistence = {
      check: async () => undefined,
      load: async () => null,
      store: async () => undefined,
    };

    await expect(
      checkRealtimeReadiness(
        persistence,
        "http://web:3000",
        (async () => new Response(null, { status: 503 })) as typeof fetch,
      ),
    ).rejects.toThrow("Web readiness check failed");
  });
});
