import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseAfterSequence, parseLimit } from "@/lib/validation";
import { serializeSequence } from "@/lib/api-safety";
import { createInternalMessagesPostHandler } from "@/lib/route-handlers";
import { validateInternalSecret } from "@/lib/internal-auth";

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
      { status: 400 },
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
        { status: 400 },
      );
    }

    let parsedAfterSequence: string | null = null;
    if (afterSequence !== null) {
      try {
        parsedAfterSequence = parseAfterSequence(afterSequence);
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 },
        );
      }
    }

    // Build where clause — exclude soft-deleted messages (TASK-0014)
    const where: Record<string, unknown> = { channelId, isDeleted: false };

    if (parsedAfterSequence !== null) {
      // Reconnection sync: messages with sequence > N
      // Must use !== null instead of truthiness check because "0" is a valid
      // afterSequence for fresh channels. (ISSUE-006)
      where.sequence = { gt: BigInt(parsedAfterSequence) };
    } else if (before) {
      // History cursor: messages with id < ULID (older messages)
      where.id = { lt: before };
    }

    // Fetch one extra to determine hasMore
    const messages = await prisma.message.findMany({
      where,
      include: {
        reactions: {
          select: { emoji: true, userId: true },
        },
      },
      orderBy: afterSequence
        ? { sequence: "asc" } // sync: oldest first
        : { id: "desc" }, // history: newest first (we'll reverse)
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

    // Batch-load user and agent authors for polymorphic authorId values
    const userAuthorIds = [
      ...new Set(
        messages
          .filter((m: (typeof messages)[number]) => m.authorType === "USER")
          .map((m: (typeof messages)[number]) => m.authorId),
      ),
    ];
    const userMap = new Map<
      string,
      { displayName: string; avatarUrl: string | null }
    >();
    if (userAuthorIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userAuthorIds } },
        select: { id: true, displayName: true, avatarUrl: true },
      });
      for (const user of users) {
        userMap.set(user.id, {
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        });
      }
    }

    // BUG-005: Also include USER-typed authorIds in agent lookup — messages
    // persisted before BUG-003 fix have authorType=USER with an Agent authorId.
    const agentAuthorIds = [
      ...new Set(
        messages
          .filter(
            (m: (typeof messages)[number]) =>
              m.authorType === "AGENT" || m.authorType === "USER",
          )
          .map((m: (typeof messages)[number]) => m.authorId),
      ),
    ];
    const agentMap = new Map<
      string,
      { name: string; avatarUrl: string | null }
    >();
    if (agentAuthorIds.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: agentAuthorIds } },
        select: { id: true, name: true, avatarUrl: true },
      });
      for (const agent of agents) {
        agentMap.set(agent.id, {
          name: agent.name,
          avatarUrl: agent.avatarUrl,
        });
      }
    }

    // Map to MessagePayload shape
    const payload = messages.map((m: (typeof messages)[number]) => {
      // BUG-002: Use descriptive fallback instead of "Unknown" for deleted authors
      let authorName =
        m.authorType === "AGENT" ? "Deleted Agent" : "Deleted User";
      let authorAvatarUrl: string | null = null;

      if (m.authorType === "AGENT") {
        const agent = agentMap.get(m.authorId);
        if (agent) {
          authorName = agent.name;
          authorAvatarUrl = agent.avatarUrl;
        }
      } else if (m.authorType === "USER") {
        const user = userMap.get(m.authorId);
        if (user) {
          authorName = user.displayName;
          authorAvatarUrl = user.avatarUrl;
        } else {
          // BUG-005: Messages persisted with authorType=USER but an Agent authorId
          // (caused by BUG-003) — fall back to agent lookup so history isn't broken
          const agent = agentMap.get(m.authorId);
          if (agent) {
            authorName = agent.name;
            authorAvatarUrl = agent.avatarUrl;
          }
        }
      } else if (m.authorType === "SYSTEM") {
        authorName = "System";
        authorAvatarUrl = null;
      }

      const reactionMap = new Map<string, string[]>();
      for (const reaction of m.reactions) {
        const existing = reactionMap.get(reaction.emoji) || [];
        existing.push(reaction.userId);
        reactionMap.set(reaction.emoji, existing);
      }
      const reactions = Array.from(reactionMap.entries()).map(
        ([emoji, userIds]) => ({
          emoji,
          count: userIds.length,
          userIds,
        }),
      );

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
        editedAt: m.editedAt?.toISOString() || null,
        thinkingTimeline: m.thinkingTimeline
          ? JSON.parse(m.thinkingTimeline)
          : undefined, // TASK-0011
        tokenHistory: m.tokenHistory ? JSON.parse(m.tokenHistory) : undefined, // TASK-0021
        checkpoints: m.checkpoints ? JSON.parse(m.checkpoints) : undefined, // TASK-0021
        metadata: m.metadata || undefined, // TASK-0039
        reactions,
      };
    });

    return NextResponse.json({
      messages: payload,
      hasMore,
    });
  } catch (error) {
    console.error("[internal/messages] Failed to fetch messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}
