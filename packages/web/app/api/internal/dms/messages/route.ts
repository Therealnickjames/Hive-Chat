import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";
import { serializeSequence } from "@/lib/api-safety";

/**
 * POST /api/internal/dms/messages — Persist a DM message.
 * Called by Gateway when a user sends a message in a DM channel. (TASK-0019)
 */
export async function POST(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, dmId, authorId, content, sequence } = body;

  if (
    typeof id !== "string" ||
    typeof dmId !== "string" ||
    typeof authorId !== "string" ||
    typeof content !== "string" ||
    (typeof sequence !== "string" &&
      typeof sequence !== "number" &&
      typeof sequence !== "bigint")
  ) {
    return NextResponse.json(
      {
        error: "Missing required fields: id, dmId, authorId, content, sequence",
      },
      { status: 400 },
    );
  }

  try {
    const message = await prisma.directMessage.create({
      data: {
        id,
        dmId,
        authorId,
        content,
        sequence: BigInt(sequence),
      },
    });

    // Update the DM channel's updatedAt for sorting
    await prisma.directMessageChannel.update({
      where: { id: dmId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      id: message.id,
      dmId: message.dmId,
      sequence: serializeSequence(message.sequence),
    });
  } catch (error) {
    console.error("Failed to persist DM message:", error);
    return NextResponse.json(
      { error: "Failed to persist message" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/internal/dms/messages — Fetch DM messages for sync/history.
 * Called by Gateway for sync and history operations. (TASK-0019)
 * Query: dmId (required), afterSequence?, before?, limit?
 */
export async function GET(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dmId = searchParams.get("dmId");

  if (!dmId) {
    return NextResponse.json({ error: "dmId is required" }, { status: 400 });
  }

  try {
    const afterSequence = searchParams.get("afterSequence");
    const before = searchParams.get("before");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10) || 50,
      100,
    );

    // Build where clause
    const where: Record<string, unknown> = { dmId, isDeleted: false };

    if (afterSequence !== null) {
      where.sequence = { gt: BigInt(afterSequence) };
    } else if (before) {
      where.id = { lt: before };
    }

    const messages = await prisma.directMessage.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            username: true,
          },
        },
      },
      orderBy: afterSequence ? { sequence: "asc" } : { id: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    if (!afterSequence) {
      messages.reverse();
    }

    const payload = messages.map((m: (typeof messages)[number]) => ({
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
      reactions: [], // DMs don't have reactions in V1
    }));

    return NextResponse.json({ messages: payload, hasMore });
  } catch (error) {
    console.error("Failed to fetch DM messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}
