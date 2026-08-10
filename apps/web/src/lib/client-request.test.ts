import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./client-request";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("retries a transient server failure and returns JSON", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("gateway failure", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      requestJson<{ status: string }>("/api/test", {
        retries: 1,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a client error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: "forbidden" } }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      requestJson("/api/test", { retries: 2, retryDelayMs: 0 }),
    ).rejects.toMatchObject({
      message: "forbidden",
      status: 403,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("turns a non-JSON success response into a recoverable gateway error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );

    await expect(requestJson("/api/test")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("normalizes network failures into a clear retriable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(requestJson("/api/test")).rejects.toMatchObject({
      message: "网络连接失败，请检查网络后重试。",
      status: 503,
    });
  });
});
