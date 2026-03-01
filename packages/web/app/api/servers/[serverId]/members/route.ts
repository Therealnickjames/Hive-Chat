import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
 * POST /api/servers/[serverId]/members — REMOVED (ISSUE-015)
 *
 * Direct server join without an invite has been disabled.
 * All server joins must go through /api/invites/{code}/accept.
 * See CONSOLIDATED-FINDINGS.md ISSUE-015 and DEC-0019.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Direct join is disabled. Use an invite link to join servers." },
    { status: 410 }
  );
}
