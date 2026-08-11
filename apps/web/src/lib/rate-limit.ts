export type RateLimitPolicy = {
  name: string;
  windowMs: number;
  ipLimit: number;
  guestLimit: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const POLICIES = {
  read: {
    name: "api-read",
    windowMs: MINUTE,
    ipLimit: 300,
    guestLimit: 240,
  },
  write: {
    name: "api-write",
    windowMs: MINUTE,
    ipLimit: 120,
    guestLimit: 90,
  },
  workspaceCreate: {
    name: "workspace-create",
    windowMs: HOUR,
    ipLimit: 20,
    guestLimit: 5,
  },
  tokenAction: {
    name: "token-action",
    windowMs: MINUTE,
    ipLimit: 60,
    guestLimit: 30,
  },
  recovery: {
    name: "workspace-recovery",
    windowMs: HOUR,
    ipLimit: 20,
    guestLimit: 10,
  },
  realtimeAuth: {
    name: "realtime-auth",
    windowMs: MINUTE,
    ipLimit: 120,
    guestLimit: 90,
  },
} satisfies Record<string, RateLimitPolicy>;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 50_000,
  ) {}

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.now();
    this.operations += 1;
    if (this.operations % 256 === 0 || this.buckets.size >= this.maxEntries) {
      this.prune(now);
    }

    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && this.buckets.size >= this.maxEntries) {
        const oldestKey = this.buckets.keys().next().value as
          string | undefined;
        if (oldestKey) this.buckets.delete(oldestKey);
      }
      bucket = { count: 0, resetAt: now + windowMs };
    } else {
      this.buckets.delete(key);
    }

    const allowed = bucket.count < limit;
    if (allowed) bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, bucket.resetAt - now),
    };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

export function resolveRateLimitPolicy(
  pathname: string,
  method: string,
): RateLimitPolicy | undefined {
  const normalizedMethod = method.toUpperCase();
  if (
    pathname.startsWith("/api/health/") ||
    pathname.startsWith("/api/avatars/")
  ) {
    return undefined;
  }

  if (pathname === "/api/workspaces" && normalizedMethod === "POST") {
    return POLICIES.workspaceCreate;
  }
  if (
    (pathname === "/api/invites" || pathname === "/api/shares") &&
    normalizedMethod === "POST"
  ) {
    return POLICIES.tokenAction;
  }
  if (pathname === "/api/recovery" && normalizedMethod === "POST") {
    return POLICIES.recovery;
  }
  if (
    pathname === "/api/realtime/token" ||
    pathname === "/api/realtime/authorize"
  ) {
    return POLICIES.realtimeAuth;
  }
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return POLICIES.read;
  }
  return POLICIES.write;
}
