import crypto from "crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/auth/token — Returns a Gateway-compatible HS256 JWT.
 * This is intentionally separate from the NextAuth session token format.
 */
function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signHs256Jwt(
  payload: Record<string, string | number>,
  secret: string
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signature}`;
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtSecret = process.env.JWT_SECRET || "dev-jwt-secret-change-in-production";

  const token = signHs256Jwt(
    {
      sub: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      email: session.user.email,
      iat: now,
      exp: now + 24 * 60 * 60,
    },
    jwtSecret
  );

  return NextResponse.json({ token });
}
