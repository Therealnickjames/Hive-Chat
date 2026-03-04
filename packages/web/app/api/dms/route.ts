import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * GET /api/dms — List current user's DM channels with last message preview.
 * Returns conversations sorted by most recent activity. (TASK-0019)
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // Find all DM channels the user participates in
    const participations = await prisma.dmParticipant.findMany({
      where: { userId },
      include: {
        dm: {
          include: {
            participants: {
              where: { userId: { not: userId } },
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
            },
            messages: {
              where: { isDeleted: false },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                content: true,
                createdAt: true,
                authorId: true,
              },
            },
          },
        },
      },
    });

    const dms = participations
      .map((p: (typeof participations)[number]) => {
        const otherParticipant = p.dm.participants[0];
        const lastMessage = p.dm.messages[0] || null;

        return {
          id: p.dm.id,
          participant: otherParticipant?.user || null,
          lastMessage: lastMessage
            ? {
                content:
                  lastMessage.content.length > 100
                    ? lastMessage.content.substring(0, 100) + "..."
                    : lastMessage.content,
                createdAt: lastMessage.createdAt.toISOString(),
                isOwn: lastMessage.authorId === userId,
              }
            : null,
          updatedAt: p.dm.updatedAt.toISOString(),
        };
      })
      // Sort by most recent message/activity
      .sort(
        (a: { updatedAt: string }, b: { updatedAt: string }) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    return NextResponse.json({ dms });
  } catch (error) {
    console.error("Failed to fetch DM channels:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/dms — Create or get existing DM channel.
 * Body: { userId } — the user to start a DM with.
 * Returns existing channel if one already exists between the two users. (TASK-0019)
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUserId = session.user.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId: targetUserId } = body;

  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (targetUserId === currentUserId) {
    return NextResponse.json(
      { error: "Cannot create a DM with yourself" },
      { status: 400 },
    );
  }

  try {
    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if they share a server (required for DM creation)
    const sharedServers = await prisma.member.findMany({
      where: {
        userId: currentUserId,
        server: {
          members: {
            some: { userId: targetUserId },
          },
        },
      },
      take: 1,
    });

    if (sharedServers.length === 0) {
      return NextResponse.json(
        { error: "You must share a server with this user to send a DM" },
        { status: 403 },
      );
    }

    // Check for existing DM channel between these two users
    const existingDm = await prisma.directMessageChannel.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: currentUserId } } },
          { participants: { some: { userId: targetUserId } } },
        ],
      },
    });

    if (existingDm) {
      return NextResponse.json({
        dm: {
          id: existingDm.id,
          participant: targetUser,
          isNew: false,
        },
      });
    }

    // Create new DM channel with both participants
    const dmId = generateId();
    await prisma.directMessageChannel.create({
      data: {
        id: dmId,
        participants: {
          create: [
            { id: generateId(), userId: currentUserId },
            { id: generateId(), userId: targetUserId },
          ],
        },
      },
    });

    return NextResponse.json({
      dm: {
        id: dmId,
        participant: targetUser,
        isNew: true,
      },
    });
  } catch (error) {
    console.error("Failed to create DM channel:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}
