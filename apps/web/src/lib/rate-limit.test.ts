import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter, resolveRateLimitPolicy } from "./rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the configured limit", () => {
    const limiter = new FixedWindowRateLimiter(() => 1_000);

    expect(limiter.consume("guest:1", 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("guest:1", 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("guest:1", 2, 60_000)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 60_000,
    });
  });

  it("starts a fresh bucket after the window expires", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(() => now);
    limiter.consume("ip:1", 1, 5_000);
    expect(limiter.consume("ip:1", 1, 5_000).allowed).toBe(false);

    now = 6_000;
    expect(limiter.consume("ip:1", 1, 5_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("bounds memory by evicting the oldest bucket", () => {
    const limiter = new FixedWindowRateLimiter(() => 1_000, 2);
    limiter.consume("first", 1, 60_000);
    limiter.consume("second", 1, 60_000);
    limiter.consume("third", 1, 60_000);

    expect(limiter.consume("first", 1, 60_000).allowed).toBe(true);
  });
});

describe("resolveRateLimitPolicy", () => {
  it("exempts health and immutable avatar endpoints", () => {
    expect(resolveRateLimitPolicy("/api/health/ready", "GET")).toBeUndefined();
    expect(resolveRateLimitPolicy("/api/avatars/seed", "GET")).toBeUndefined();
  });

  it("applies tighter policies to sensitive operations", () => {
    expect(resolveRateLimitPolicy("/api/workspaces", "POST")).toMatchObject({
      name: "workspace-create",
      guestLimit: 5,
    });
    expect(resolveRateLimitPolicy("/api/recovery", "POST")).toMatchObject({
      name: "workspace-recovery",
      guestLimit: 10,
    });
    expect(resolveRateLimitPolicy("/api/realtime/token", "GET")).toMatchObject({
      name: "realtime-auth",
    });
  });

  it("separates ordinary reads and mutations", () => {
    expect(resolveRateLimitPolicy("/api/workspaces", "GET")?.name).toBe(
      "api-read",
    );
    expect(resolveRateLimitPolicy("/api/documents", "POST")?.name).toBe(
      "api-write",
    );
  });
});
