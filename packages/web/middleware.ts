import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { RateLimiter } from "@/lib/rate-limit";

// Rate limiter for login attempts: 10 per 60s per IP
const loginLimiter = new RateLimiter({ max: 10, windowSec: 60 });

const publicRoutes = ["/login", "/register"];
const publicPrefixes = ["/api/auth", "/api/health", "/api/internal", "/api/v1"];

function isPublicRoute(pathname: string): boolean {
  if (publicRoutes.includes(pathname)) return true;
  return publicPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // Rate limit login attempts (POST to NextAuth credentials callback)
  if (
    pathname.startsWith("/api/auth/callback/credentials") &&
    request.method === "POST"
  ) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const rl = loginLimiter.check(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        },
      );
    }
  }

  let token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Be explicit about cookie names so auth works consistently across mixed local environments.
  if (!token) {
    token =
      (await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName: "__Secure-next-auth.session-token",
      })) ||
      (await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName: "next-auth.session-token",
      }));
  }

  // Authenticated user accessing auth pages → redirect to app
  if (token && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Public route → allow through
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Unauthenticated → redirect to login
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
