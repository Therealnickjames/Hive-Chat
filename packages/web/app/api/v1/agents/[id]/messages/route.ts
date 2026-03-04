import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import { authenticateAgentRequest } from "@/lib/agent-auth";
import {
  broadcastMessageNew,
  broadcastStreamStart,
} from "@/lib/gateway-client";

/**
 * GET /api/v1/agents/{id}/messages — Poll for messages (DEC-0043, Phase 4)
 *
 * REST polling endpoint. Agent calls this to receive messages that triggered it.
 * Supports long-polling via ?wait=N (seconds).
 *
 * Auth: Authorization: Bearer sk-tvk-...
 *
 * Query params:
 *   channel_id — filter to specific channel
 *   limit — max messages (default 50, max 100)
 *   ack — if true, mark returned messages as delivered
 *   wait — long-polling timeout in seconds (0-30, default 0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  const agent = await authenticateAgentRequest(request);
  if (!agent || agent.botId !== agentId) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channel_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const ack = searchParams.get("ack") === "true";
  const wait = Math.min(parseInt(searchParams.get("wait") || "0", 10), 30);

  try {
    // Build query
    const where: Record<string, unknown> = {
      botId: agentId,
      delivered: false,
    };
    if (channelId) {
      where.channelId = channelId;
    }

    // Initial fetch
    let messages = await prisma.agentMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Simple long-poll: if no messages and wait > 0, poll periodically
    if (messages.length === 0 && wait > 0) {
      const deadline = Date.now() + wait * 1000;
      while (Date.now() < deadline && messages.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        messages = await prisma.agentMessage.findMany({
          where,
          orderBy: { createdAt: "asc" },
          take: limit,
        });
      }
    }

    // Mark as delivered if ack=true
    if (ack && messages.length > 0) {
      const ids = messages.map((m) => m.id);
      await prisma.agentMessage.updateMany({
        where: { id: { in: ids } },
        data: { delivered: true },
      });
    }

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        messageId: m.messageId,
        content: m.content,
        authorId: m.authorId,
        authorName: m.authorName,
        authorType: m.authorType,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore: messages.length === limit,
      pollAgainAfterMs: messages.length === 0 ? 1000 : 0,
    });
  } catch (error) {
    console.error("Agent message poll failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/agents/{id}/messages — Send a message or start streaming (DEC-0043)
 *
 * Auth: Authorization: Bearer sk-tvk-...
 *
 * Simple message: {"channelId": "...", "content": "Hello!"}
 * Start stream: {"channelId": "...", "streaming": true}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  const agent = await authenticateAgentRequest(request);
  if (!agent || agent.botId !== agentId) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelId, content, streaming } = body as {
    channelId?: string;
    content?: string;
    streaming?: boolean;
  };

  if (!channelId || typeof channelId !== "string") {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  // Verify channel belongs to agent's server
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });

  if (!channel || channel.serverId !== agent.serverId) {
    return NextResponse.json(
      { error: "Channel not found or not in agent's server" },
      { status: 403 }
    );
  }

  const messageId = ulid();
  const sequence = String(Date.now()); // fallback sequence

  try {
    if (streaming) {
      // Start streaming
      await persistMessage({
        id: messageId,
        channelId,
        authorId: agent.botId,
        authorType: "BOT",
        content: "",
        type: "STREAMING",
        streamingStatus: "ACTIVE",
        sequence,
      });

      await broadcastStreamStart(channelId, {
        messageId,
        botId: agent.botId,
        botName: agent.botName,
        botAvatarUrl: agent.botAvatarUrl,
        sequence,
      });

      const webUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

      return NextResponse.json(
        {
          messageId,
          sequence,
          streamUrl: `${webUrl}/api/v1/agents/${agentId}/messages/${messageId}/stream`,
        },
        { status: 201 }
      );
    }

    // Simple message
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "content is required (or use streaming: true)" },
        { status: 400 }
      );
    }

    await persistMessage({
      id: messageId,
      channelId,
      authorId: agent.botId,
      authorType: "BOT",
      content,
      type: "STANDARD",
      sequence,
    });

    await broadcastMessageNew(channelId, {
      id: messageId,
      channelId,
      authorId: agent.botId,
      authorType: "BOT",
      authorName: agent.botName,
      authorAvatarUrl: agent.botAvatarUrl,
      content,
      type: "STANDARD",
      streamingStatus: null,
      sequence,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ messageId, sequence });
  } catch (error) {
    console.error("Agent message send failed:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}

async function persistMessage(data: Record<string, unknown>) {
  const internalUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  await fetch(`${internalUrl}/api/internal/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
    },
    body: JSON.stringify(data),
  }).catch((err) => console.error("Persist failed:", err));
}
