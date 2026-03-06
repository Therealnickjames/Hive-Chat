/**
 * In-memory sliding-window rate limiter for Next.js API routes.
 *
 * Each limiter instance tracks request counts per IP using a Map with
 * automatic expiry. Suitable for single-instance deployments. For
 * multi-instance, swap to Redis-backed (e.g. @upstash/ratelimit).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window duration in seconds. */
  windowSec: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(opts: RateLimiterOptions) {
    this.max = opts.max;
    this.windowMs = opts.windowSec * 1000;

    // Periodic cleanup every 60s to prevent memory leaks
    const interval = setInterval(() => this.cleanup(), 60_000);
    // Allow Node to exit even if the interval is still running
    if (typeof interval === "object" && "unref" in interval) {
      interval.unref();
    }
  }

  /**
   * Check if a request from `key` (typically an IP) is allowed.
   * Returns { allowed, remaining, resetAt }.
   */
  check(key: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      // New window
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return {
        allowed: true,
        remaining: this.max - 1,
        resetAt: now + this.windowMs,
      };
    }

    if (entry.count >= this.max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.max - entry.count,
      resetAt: entry.resetAt,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Extract client IP from a Next.js request.
 * Checks x-forwarded-for (reverse proxy), x-real-ip, then falls back to "unknown".
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be comma-separated; first entry is the client
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}

// ── Pre-configured limiters for critical endpoints ──

/** Auth endpoints: 10 requests per 60s per IP (login, register) */
export const authLimiter = new RateLimiter({ max: 10, windowSec: 60 });

/** Agent registration: 5 requests per 60s per IP */
export const agentRegistrationLimiter = new RateLimiter({
  max: 5,
  windowSec: 60,
});

/** Webhook inbound: 60 requests per 60s per token */
export const webhookLimiter = new RateLimiter({ max: 60, windowSec: 60 });
