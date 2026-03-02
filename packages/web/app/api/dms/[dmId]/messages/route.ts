import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeSequence } from "@/lib/api-safety";

/**
 * GET /api/dms/{dmId}/messages — Fetch DM message history.
 * Supports cursor pagination with ?before=<messageId>&limit=50.
 * Auth: current user must be a participant. (TASK-0019)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dmId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dmId } = await params;
  const userId = session.user.id;

  try {
    // Verify the user is a participant
    const participant = await prisma.dmParticipant.findUnique({
      where: { dmId_userId: { dmId, userId } },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "Not a participant in this conversation" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get("before");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 100);

    const where: Record<string, unknown> = { dmId, isDeleted: false };
    if (before) {
      where.id = { lt: before };
    }

    const messages = await prisma.directMessage.findMany({
      where,
      include: {
        author: {
          select: { id: true, displayName: true, avatarUrl: true, username: true },
        },
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    // Reverse to chronological order
    messages.reverse();

    const payload = messages.map((m) => ({
      id: m.id,
      dmId: m.dmId,
      authorId: m.authorId,
      authorType: "USER",
      authorName: m.author.displayName,
      authorAvatarUrl: m.author.avatarUrl,
      content: m.content,
      type: "STANDARD",
      streamingStatus: null,
      sequence: serializeSequence(m.sequence),
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() || null,
      reactions: [],
    }));

    return NextResponse.json({ messages: payload, hasMore });
  } catch (error) {
    console.error("Failed to fetch DM messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
