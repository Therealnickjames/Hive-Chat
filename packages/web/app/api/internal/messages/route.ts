import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseAfterSequence, parseLimit } from "@/lib/validation";
import {
  serializeSequence,
} from "@/lib/api-safety";
import { createInternalMessagesPostHandler } from "@/lib/route-handlers";

// Internal API secret validation
function validateInternalSecret(request: NextRequest): boolean {
  const secret = request.headers.get("x-internal-secret");
  return secret === process.env.INTERNAL_API_SECRET;
}

/**
 * POST /api/internal/messages — Persist a message
 * Called by Gateway (for user messages) and Go Proxy (for completed streaming messages)
 * See docs/PROTOCOL.md §3
 */
export const POST = createInternalMessagesPostHandler({ prismaClient: prisma });

/**
 * GET /api/internal/messages — Fetch messages for sync or history
 * Query params: channelId (required), afterSequence?, before?, limit?
 * See docs/PROTOCOL.md §3
 */
export async function GET(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  if (!channelId) {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  try {
    const afterSequence = searchParams.get("afterSequence");
    const before = searchParams.get("before");
    let limit = 50;
    try {
      limit = parseLimit(searchParams.get("limit"));
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 }
      );
    }

    let parsedAfterSequence: string | null = null;
    if (afterSequence !== null) {
      try {
        parsedAfterSequence = parseAfterSequence(afterSequence);
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
      }
    }

    // Build where clause
    const where: Record<string, unknown> = { channelId };

    if (parsedAfterSequence) {
      // Reconnection sync: messages with sequence > N
      where.sequence = { gt: BigInt(parsedAfterSequence) };
    } else if (before) {
      // History cursor: messages with id < ULID (older messages)
      where.id = { lt: before };
    }

    // Fetch one extra to determine hasMore
    const messages = await prisma.message.findMany({
      where,
      orderBy: afterSequence
        ? { sequence: "asc" }  // sync: oldest first
        : { id: "desc" },      // history: newest first (we'll reverse)
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    // For history mode (no afterSequence), reverse to chronological order
    if (!afterSequence) {
      messages.reverse();
    }

    // Batch-load user and bot authors for polymorphic authorId values
    const userAuthorIds = [
      ...new Set(
        messages
          .filter((m) => m.authorType === "USER")
          .map((m) => m.authorId)
      ),
    ];
    const userMap = new Map<string, { displayName: string; avatarUrl: string | null }>();
    if (userAuthorIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userAuthorIds } },
        select: { id: true, displayName: true, avatarUrl: true },
      });
      for (const user of users) {
        userMap.set(user.id, { displayName: user.displayName, avatarUrl: user.avatarUrl });
      }
    }

    const botAuthorIds = [
      ...new Set(
        messages
          .filter((m) => m.authorType === "BOT")
          .map((m) => m.authorId)
      ),
    ];
    const botMap = new Map<string, { name: string; avatarUrl: string | null }>();
    if (botAuthorIds.length > 0) {
      const bots = await prisma.bot.findMany({
        where: { id: { in: botAuthorIds } },
        select: { id: true, name: true, avatarUrl: true },
      });
      for (const bot of bots) {
        botMap.set(bot.id, { name: bot.name, avatarUrl: bot.avatarUrl });
      }
    }

    // Map to MessagePayload shape
    const payload = messages.map((m) => {
      let authorName = "Unknown";
      let authorAvatarUrl: string | null = null;

      if (m.authorType === "BOT") {
        const bot = botMap.get(m.authorId);
        if (bot) {
          authorName = bot.name;
          authorAvatarUrl = bot.avatarUrl;
        }
      } else if (m.authorType === "USER") {
        const user = userMap.get(m.authorId);
        if (user) {
          authorName = user.displayName;
          authorAvatarUrl = user.avatarUrl;
        }
      }

      return {
        id: m.id,
        channelId: m.channelId,
        authorId: m.authorId,
        authorType: m.authorType,
        authorName,
        authorAvatarUrl,
        content: m.content,
        type: m.type,
        streamingStatus: m.streamingStatus,
        sequence: serializeSequence(m.sequence),
        createdAt: m.createdAt.toISOString(),
      };
    });

    return NextResponse.json({
      messages: payload,
      hasMore,
    });
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

