import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * GET /api/servers — List servers the current user is a member of
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const memberships = await prisma.member.findMany({
      where: { userId: session.user.id },
      include: {
        server: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    const servers = memberships.map((m) => ({
      id: m.server.id,
      name: m.server.name,
      iconUrl: m.server.iconUrl,
      ownerId: m.server.ownerId,
      memberCount: m.server._count.members,
      joinedAt: m.joinedAt.toISOString(),
    }));

    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Failed to list servers:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/servers — Create a new server
 * Body: { name: string }
 * Creates server + default #general channel + owner membership in a transaction
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = body.name?.trim();

    if (!name || name.length < 1 || name.length > 100) {
      return NextResponse.json(
        { error: "Server name must be 1-100 characters" },
        { status: 400 }
      );
    }

    const serverId = generateId();
    const channelId = generateId();
    const memberId = generateId();

    const [server] = await prisma.$transaction([
      prisma.server.create({
        data: {
          id: serverId,
          name,
          ownerId: session.user.id,
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
          userId: session.user.id,
          serverId,
        },
      }),
    ]);

    return NextResponse.json(
      {
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        ownerId: server.ownerId,
        defaultChannelId: channelId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
