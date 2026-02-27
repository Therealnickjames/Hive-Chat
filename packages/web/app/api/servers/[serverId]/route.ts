import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/servers/[serverId] — Server detail with channels and member count
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
    // Verify user is a member
    const membership = await prisma.member.findUnique({
      where: {
        userId_serverId: {
          userId: session.user.id,
          serverId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        channels: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            topic: true,
            position: true,
            defaultBotId: true,
          },
        },
        _count: { select: { members: true } },
      },
    });

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      ownerId: server.ownerId,
      channels: server.channels,
      memberCount: server._count.members,
    });
  } catch (error) {
    console.error("Failed to get server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
