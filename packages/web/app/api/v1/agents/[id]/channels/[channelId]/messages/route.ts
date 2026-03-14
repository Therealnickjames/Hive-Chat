import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAgentRequest } from "@/lib/agent-auth";
import { serializeSequence } from "@/lib/api-safety";
import { checkAgentRateLimit } from "@/lib/rate-limit";
import { logAgentAction } from "@/lib/agent-audit";
import { verifyAgentChannelAccess } from "@/lib/agent-channel-acl";

/**
 * GET /api/v1/agents/{id}/channels/{channelId}/messages — Channel history
 *
 * Returns messages from a channel the agent has access to.
 * Supports cursor pagination via ?before=ULID (older) or ?after_sequence=N (sync).
 *
 * Auth: Authorization: Bearer sk-tvk-...
 *
 * Query params:
 *   limit  — max messages to return (default 50, max 100)
 *   before — ULID cursor: return messages older than this ID
 *   after_sequence — sequence cursor: return messages newer than this sequence
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  const { id: agentId, channelId } = await params;

  const agent = await authenticateAgentRequest(request);
  if (!agent || agent.agentId !== agentId) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  const channelAccess = await verifyAgentChannelAccess(agent, channelId);
  if (!channelAccess.ok) {
    return NextResponse.json(
      { error: channelAccess.error },
      { status: channelAccess.status },
    );
  }

  // ── Rate limiting (per-agent) ──
  const rateCheck = checkAgentRateLimit(agent.agentId);
  if (!rateCheck.allowed) {
    logAgentAction({
      agentId: agent.agentId,
      serverId: agent.serverId,
      action: "rate_limited",
      channelId,
    });
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfterMs: rateCheck.resetAt - Date.now(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rateCheck.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  logAgentAction({
    agentId: agent.agentId,
    serverId: agent.serverId,
    action: "channel_history_read",
    channelId,
  });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
    100,
  );
  const before = searchParams.get("before");
  const afterSequence = searchParams.get("after_sequence");

  try {
    // Build where clause — exclude soft-deleted messages
    const where: Record<string, unknown> = { channelId, isDeleted: false };

    if (afterSequence !== null) {
      const parsed = BigInt(afterSequence);
      if (parsed < 0) {
        return NextResponse.json(
          { error: "after_sequence must be a non-negative integer" },
          { status: 400 },
        );
      }
      where.sequence = { gt: parsed };
    } else if (before) {
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

    // For history mode, reverse to chronological order
    if (!afterSequence) {
      messages.reverse();
    }

    // Batch-load authors
    const userAuthorIds = [
      ...new Set(
        messages.filter((m) => m.authorType === "USER").map((m) => m.authorId),
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

    const agentAuthorIds = [
      ...new Set(
        messages.filter((m) => m.authorType === "AGENT").map((m) => m.authorId),
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

    const payload = messages.map((m) => {
      // BUG-002: Use descriptive fallback instead of "Unknown" for deleted authors
      let authorName =
        m.authorType === "AGENT" ? "Deleted Agent" : "Deleted User";
      let authorAvatarUrl: string | null = null;

      if (m.authorType === "AGENT") {
        const foundAgent = agentMap.get(m.authorId);
        if (foundAgent) {
          authorName = foundAgent.name;
          authorAvatarUrl = foundAgent.avatarUrl;
        }
      } else if (m.authorType === "USER") {
        const user = userMap.get(m.authorId);
        if (user) {
          authorName = user.displayName;
          authorAvatarUrl = user.avatarUrl;
        }
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
        metadata: m.metadata || undefined,
        reactions,
      };
    });

    return NextResponse.json({
      messages: payload,
      hasMore,
    });
  } catch (error) {
    if (error instanceof RangeError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid cursor parameter" },
        { status: 400 },
      );
    }
    console.error(
      "[v1/agents/channels/messages] Channel history fetch failed:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}
