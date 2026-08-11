import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("API rate limit proxy", () => {
  it("returns a structured 429 after a guest exceeds a sensitive limit", async () => {
    const request = new NextRequest("https://docs.example.com/api/workspaces", {
      method: "POST",
      headers: {
        cookie: "collabdocs_guest=cdg_rate_limit_test",
        "x-forwarded-for": "203.0.113.42",
      },
    });

    for (let index = 0; index < 5; index += 1) {
      expect(proxy(request).status).toBe(200);
    }

    const response = proxy(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后重试。",
      },
    });
  });

  it("does not rate limit health checks", () => {
    const request = new NextRequest(
      "https://docs.example.com/api/health/ready",
      { headers: { "x-forwarded-for": "203.0.113.43" } },
    );

    for (let index = 0; index < 500; index += 1) {
      expect(proxy(request).status).toBe(200);
    }
  });
});
