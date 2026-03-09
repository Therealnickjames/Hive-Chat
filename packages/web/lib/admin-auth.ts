import crypto from "crypto";

/**
 * Admin token authentication for bootstrap endpoints.
 *
 * Validates the TAVOK_ADMIN_TOKEN from .env against the Authorization header.
 * Used by POST /api/v1/bootstrap and POST /api/v1/bootstrap/agents.
 *
 * Security properties:
 * - Constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks
 * - Rejects requests with Origin header (CSRF protection)
 * - Returns false if TAVOK_ADMIN_TOKEN is not configured (endpoint disabled)
 */
export function authenticateAdminToken(request: Request): boolean {
  const expectedToken = process.env.TAVOK_ADMIN_TOKEN;
  if (!expectedToken) {
    return false;
  }

  // CSRF protection: reject browser-originated requests
  if (request.headers.get("origin")) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer admin-")) {
    return false;
  }

  const providedToken = authHeader.slice("Bearer admin-".length);
  if (!providedToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(expectedToken, "utf-8");
  const provided = Buffer.from(providedToken, "utf-8");

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}
