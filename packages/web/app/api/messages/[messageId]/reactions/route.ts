import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * GET /api/messages/[messageId]/reactions — Get reactions for a message
 * Returns aggregated reactions: [{ emoji, count, userIds, hasReacted }]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureMessageAccess(messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return getReactionsResponse(messageId, session.user.id);
}

/**
 * POST /api/messages/[messageId]/reactions — Add a reaction
 * Body: { emoji: string }
 * Idempotent: if already reacted with this emoji, returns 200
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureMessageAccess(messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const body = await request.json();
    const emoji = body?.emoji?.trim();

    if (!emoji || emoji.length > 32) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }

    await prisma.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: session.user.id,
          emoji,
        },
      },
      update: {},
      create: {
        id: generateId(),
        messageId,
        userId: session.user.id,
        emoji,
      },
    });

    return getReactionsResponse(messageId, session.user.id);
  } catch (error) {
    console.error("Failed to add reaction:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/messages/[messageId]/reactions — Remove a reaction
 * Body: { emoji: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await ensureMessageAccess(messageId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const body = await request.json();
    const emoji = body?.emoji?.trim();

    if (!emoji || emoji.length > 32) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }

    await prisma.reaction.deleteMany({
      where: {
        messageId,
        userId: session.user.id,
        emoji,
      },
    });

    return getReactionsResponse(messageId, session.user.id);
  } catch (error) {
    console.error("Failed to remove reaction:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function ensureMessageAccess(messageId: string, userId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      channel: {
        select: {
          serverId: true,
        },
      },
    },
  });

  if (!message) {
    return { ok: false as const, status: 404, error: "Message not found" };
  }

  const membership = await prisma.member.findUnique({
    where: {
      userId_serverId: {
        userId,
        serverId: message.channel.serverId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    return { ok: false as const, status: 403, error: "Not a member" };
  }

  return { ok: true as const };
}

/** Helper to build aggregated reaction response */
async function getReactionsResponse(messageId: string, currentUserId: string) {
  const reactions = await prisma.reaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });

  const aggregated = new Map<string, string[]>();
  for (const reaction of reactions) {
    const existing = aggregated.get(reaction.emoji) || [];
    existing.push(reaction.userId);
    aggregated.set(reaction.emoji, existing);
  }

  const result = Array.from(aggregated.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
    hasReacted: userIds.includes(currentUserId),
  }));

  return NextResponse.json({ reactions: result });
}
