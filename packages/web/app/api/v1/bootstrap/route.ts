import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { authenticateAdminToken } from "@/lib/admin-auth";
import { RateLimiter, getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/v1/bootstrap — First-run setup endpoint.
 *
 * Creates admin user, default server with #general channel, and enables
 * agent self-registration. Called by the CLI after services are healthy.
 *
 * Three independent guards (defense in depth):
 * 1. Admin token required (TAVOK_ADMIN_TOKEN from .env)
 * 2. First-run guard (user count must be 0)
 * 3. Rate limiting (10 per 60s per IP)
 */

const bootstrapLimiter = new RateLimiter({ max: 10, windowSec: 60 });

const bootstrapSchema = z.object({
  email: z.string().email("Invalid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(32, "Display name must be at most 32 characters"),
  serverName: z
    .string()
    .min(1, "Server name is required")
    .max(100, "Server name must be at most 100 characters")
    .default("Tavok"),
});

export async function POST(request: Request) {
  // Guard 1: Admin token
  if (!authenticateAdminToken(request)) {
    return NextResponse.json(
      { error: "Invalid or missing admin token" },
      { status: 401 },
    );
  }

  // Guard 3: Rate limit
  const ip = getClientIp(request);
  const rl = bootstrapLimiter.check(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  // Guard 2: First-run check
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return NextResponse.json(
      { error: "Bootstrap already completed. Users exist in the database." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const data = bootstrapSchema.parse(body);

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const userId = generateId();
    const serverId = generateId();
    const channelId = generateId();
    const memberId = generateId();
    const everyoneRoleId = generateId();

    // Create everything in a single transaction
    await prisma.$transaction([
      prisma.user.create({
        data: {
          id: userId,
          email: data.email,
          username: data.username,
          displayName: data.displayName,
          password: hashedPassword,
        },
      }),
      prisma.server.create({
        data: {
          id: serverId,
          name: data.serverName,
          ownerId: userId,
          allowAgentRegistration: true,
          registrationApprovalRequired: false,
        },
      }),
      prisma.channel.create({
        data: {
          id: channelId,
          serverId,
          name: "general",
          type: "TEXT",
          position: 0,
        },
      }),
      prisma.member.create({
        data: {
          id: memberId,
          userId,
          serverId,
        },
      }),
      prisma.role.create({
        data: {
          id: everyoneRoleId,
          serverId,
          name: "@everyone",
          permissions: DEFAULT_PERMISSIONS,
          position: 0,
        },
      }),
    ]);

    // Connect member to @everyone role (separate query — same pattern as POST /api/servers)
    await prisma.member.update({
      where: { id: memberId },
      data: {
        roles: { connect: { id: everyoneRoleId } },
      },
    });

    const gatewayUrl =
      process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:4001/socket";
    const webUrl = process.env.NEXTAUTH_URL || "http://localhost:5555";

    return NextResponse.json(
      {
        admin: {
          email: data.email,
          username: data.username,
        },
        server: {
          id: serverId,
          name: data.serverName,
        },
        channel: {
          id: channelId,
          name: "general",
        },
        urls: {
          web: webUrl,
          gateway: gatewayUrl,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 },
      );
    }
    // Concurrent bootstrap race: unique constraint on email/username
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Bootstrap already completed (concurrent request)." },
        { status: 409 },
      );
    }
    console.error("Bootstrap error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
