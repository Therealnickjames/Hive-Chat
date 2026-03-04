import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import { broadcastToChannel } from "@/lib/gateway-client";

/**
 * GET /api/dms/[dmId]/messages/[messageId]/reactions
 * Returns aggregated DM reactions: [{ emoji, count, userIds, hasReacted }]
 * (TASK-0030)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dmId: string; messageId: string }> }
) {
  const { dmId, messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureDmMessageAccess(dmId, messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return getReactionsResponse(messageId, session.user.id);
}

/**
 * POST /api/dms/[dmId]/messages/[messageId]/reactions
 * Add a reaction to a DM message.
 * Body: { emoji: string }
 * Idempotent: if already reacted with this emoji, returns 200
 * (TASK-0030)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dmId: string; messageId: string }> }
) {
  const { dmId, messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureDmMessageAccess(dmId, messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const body = await request.json();
    const emoji = body?.emoji?.trim();

    if (!emoji || emoji.length > 32) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }

    await prisma.dmReaction.upsert({
      where: {
        dmMessageId_userId_emoji: {
          dmMessageId: messageId,
          userId: session.user.id,
          emoji,
        },
      },
      update: {},
      create: {
        id: generateId(),
        dmMessageId: messageId,
        userId: session.user.id,
        emoji,
      },
    });

    // Broadcast to all clients in the DM channel
    const updatedReactions = await getAggregatedReactions(messageId);
    broadcastDmReactionUpdate(dmId, messageId, updatedReactions);

    return NextResponse.json({
      reactions: updatedReactions.map((r) => ({
        ...r,
        hasReacted: r.userIds.includes(session.user.id),
      })),
    });
  } catch (error) {
    console.error("Failed to add DM reaction:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/dms/[dmId]/messages/[messageId]/reactions
 * Remove a reaction from a DM message.
 * Body: { emoji: string }
 * (TASK-0030)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ dmId: string; messageId: string }> }
) {
  const { dmId, messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureDmMessageAccess(dmId, messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const body = await request.json();
    const emoji = body?.emoji?.trim();

    if (!emoji || emoji.length > 32) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }

    await prisma.dmReaction.deleteMany({
      where: {
        dmMessageId: messageId,
        userId: session.user.id,
        emoji,
      },
    });

    // Broadcast to all clients in the DM channel
    const updatedReactions = await getAggregatedReactions(messageId);
    broadcastDmReactionUpdate(dmId, messageId, updatedReactions);

    return NextResponse.json({
      reactions: updatedReactions.map((r) => ({
        ...r,
        hasReacted: r.userIds.includes(session.user.id),
      })),
    });
  } catch (error) {
    console.error("Failed to remove DM reaction:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Verify user is a participant in this DM and the message belongs to it */
async function ensureDmMessageAccess(dmId: string, messageId: string, userId: string) {
  // Check participation
  const participant = await prisma.dmParticipant.findUnique({
    where: {
      dmId_userId: { dmId, userId },
    },
    select: { id: true },
  });

  if (!participant) {
    return { ok: false as const, status: 403, error: "Not a participant" };
  }

  // Check message belongs to this DM
  const message = await prisma.directMessage.findUnique({
    where: { id: messageId },
    select: { dmId: true },
  });

  if (!message || message.dmId !== dmId) {
    return { ok: false as const, status: 404, error: "Message not found" };
  }

  return { ok: true as const };
}

/** Build aggregated reactions from DB */
async function getAggregatedReactions(messageId: string) {
  const reactions = await prisma.dmReaction.findMany({
    where: { dmMessageId: messageId },
    select: { emoji: true, userId: true },
  });

  const aggregated = new Map<string, string[]>();
  for (const reaction of reactions) {
    const existing = aggregated.get(reaction.emoji) || [];
    existing.push(reaction.userId);
    aggregated.set(reaction.emoji, existing);
  }

  return Array.from(aggregated.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
  }));
}

/** Build aggregated reaction HTTP response */
async function getReactionsResponse(messageId: string, currentUserId: string) {
  const result = await getAggregatedReactions(messageId);

  return NextResponse.json({
    reactions: result.map((r) => ({
      ...r,
      hasReacted: r.userIds.includes(currentUserId),
    })),
  });
}

/** Broadcast reaction update to all connected clients in the DM channel (TASK-0030) */
function broadcastDmReactionUpdate(
  dmId: string,
  messageId: string,
  reactions: { emoji: string; count: number; userIds: string[] }[]
) {
  broadcastToChannel(`dm:${dmId}`, "reaction_update", {
    messageId,
    reactions,
  }).catch((err) => {
    console.error("Failed to broadcast DM reaction update:", err);
  });
}
