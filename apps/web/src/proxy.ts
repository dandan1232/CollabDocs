import { createHash, randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  FixedWindowRateLimiter,
  resolveRateLimitPolicy,
  type RateLimitResult,
} from "./lib/rate-limit";

const GUEST_SESSION_COOKIE = "collabdocs_guest";
const limiter = new FixedWindowRateLimiter();

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",").at(-1)?.trim();
  return forwardedIp || request.headers.get("x-real-ip") || "unknown";
}

function getGuestKey(request: NextRequest): string | undefined {
  const credential = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!credential) return undefined;
  return createHash("sha256").update(credential).digest("hex");
}

function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后重试。",
        requestId: randomUUID(),
      },
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
      },
    },
  );
}

export function proxy(request: NextRequest) {
  const policy = resolveRateLimitPolicy(
    request.nextUrl.pathname,
    request.method,
  );
  if (!policy) return NextResponse.next();

  const ipResult = limiter.consume(
    `${policy.name}:ip:${getClientIp(request)}`,
    policy.ipLimit,
    policy.windowMs,
  );
  if (!ipResult.allowed) return rateLimitResponse(ipResult);

  const guestKey = getGuestKey(request);
  const guestResult = guestKey
    ? limiter.consume(
        `${policy.name}:guest:${guestKey}`,
        policy.guestLimit,
        policy.windowMs,
      )
    : undefined;
  if (guestResult && !guestResult.allowed) {
    return rateLimitResponse(guestResult);
  }

  const result = guestResult ?? ipResult;
  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1_000)),
  );
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
