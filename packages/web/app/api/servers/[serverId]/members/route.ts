import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * GET /api/servers/[serverId]/members — List members with user info
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    // Verify membership
    const membership = await prisma.member.findUnique({
      where: {
        userId_serverId: { userId: session.user.id, serverId },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const members = await prisma.member.findMany({
      where: { serverId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    const payload = members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      username: m.user.username,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      nickname: m.nickname,
      joinedAt: m.joinedAt.toISOString(),
    }));

    return NextResponse.json({ members: payload });
  } catch (error) {
    console.error("Failed to list members:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/members — Join a server (direct join for MVP)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    // Verify server exists
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, name: true },
    });

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Check if already a member
    const existing = await prisma.member.findUnique({
      where: {
        userId_serverId: { userId: session.user.id, serverId },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Already a member" },
        { status: 409 }
      );
    }

    const member = await prisma.member.create({
      data: {
        id: generateId(),
        userId: session.user.id,
        serverId,
      },
    });

    return NextResponse.json(
      { id: member.id, serverId, joinedAt: member.joinedAt.toISOString() },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to join server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
