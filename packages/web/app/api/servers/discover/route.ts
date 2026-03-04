import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/servers/discover — List all servers for discovery (MVP: public listing)
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const servers = await prisma.server.findMany({
      include: {
        _count: { select: { members: true } },
        owner: {
          select: { displayName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Check which servers the user is already a member of
    const memberships = await prisma.member.findMany({
      where: { userId: session.user.id },
      select: { serverId: true },
    });
    const memberServerIds = new Set(memberships.map((m) => m.serverId));

    const payload = servers.map((s) => ({
      id: s.id,
      name: s.name,
      iconUrl: s.iconUrl,
      ownerName: s.owner.displayName,
      memberCount: s._count.members,
      isMember: memberServerIds.has(s.id),
      createdAt: s.createdAt.toISOString(),
    }));

    return NextResponse.json({ servers: payload });
  } catch (error) {
    console.error("Failed to discover servers:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
