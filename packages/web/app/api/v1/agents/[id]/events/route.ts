import { NextRequest } from "next/server";
import {
  authenticateAgentKey,
  authenticateAgentRequest,
} from "@/lib/agent-auth";
import { prisma } from "@/lib/db";
import { verifyAgentChannelsAccess } from "@/lib/agent-channel-acl";

/**
 * GET /api/v1/agents/{id}/events — SSE event stream (DEC-0043, Phase 5)
 *
 * Real-time event stream via Server-Sent Events. Agent receives:
 * - message_new: new messages in subscribed channels (polled from DB)
 * - heartbeat: keepalive every 15 seconds
 *
 * Note: This endpoint polls the Message table for new rows. It does NOT
 * relay real-time streaming events (stream_start, stream_token, etc.) —
 * those flow through the Gateway WebSocket transport. For full streaming
 * event support, agents should use WebSocket or the REST callback API.
 *
 * Auth: Authorization: Bearer sk-tvk-... or ?api_key=sk-tvk-...
 *
 * Query params:
 *   channels — comma-separated assigned channel IDs to subscribe to
 *   api_key — alternative auth for browser EventSource
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  // Authenticate via header or query param
  let agent = await authenticateAgentRequest(request);
  if (!agent) {
    const { searchParams } = new URL(request.url);
    const apiKey = searchParams.get("api_key");
    if (apiKey) {
      agent = await authenticateAgentKey(apiKey);
    }
  }

  if (!agent || agent.agentId !== agentId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(request.url);
  const channelsParam = searchParams.get("channels");

  if (!channelsParam) {
    return new Response(
      JSON.stringify({ error: "channels query parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const channelIds = channelsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const channelAccess = await verifyAgentChannelsAccess(agent, channelIds);
  if (!channelAccess.ok) {
    return new Response(
      JSON.stringify({
        error: channelAccess.error,
      }),
      {
        status: channelAccess.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send connected event
      const connectedEvent = `event: connected\ndata: ${JSON.stringify({
        agentId,
        channels: channelIds,
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(connectedEvent));

      // Heartbeat every 15 seconds
      const heartbeat = setInterval(() => {
        if (isClosed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          const event = `event: heartbeat\ndata: ${JSON.stringify({
            timestamp: new Date().toISOString(),
          })}\n\n`;
          controller.enqueue(encoder.encode(event));
        } catch {
          clearInterval(heartbeat);
          isClosed = true;
        }
      }, 15000);

      // Poll for new messages every 2 seconds and send as SSE events.
      // Uses ID-based cursor (gte + Set) to avoid missing rows that share
      // a timestamp boundary, and pages through bursts larger than 50.
      let lastPollTime = new Date();
      const seenIds = new Set<string>();

      const pollInterval = setInterval(async () => {
        if (isClosed) {
          clearInterval(pollInterval);
          return;
        }

        try {
          // Use gte (>=) to catch rows sharing the boundary timestamp,
          // then deduplicate with seenIds to avoid re-emitting.
          const newMessages = await prisma.message.findMany({
            where: {
              channelId: { in: channelIds },
              createdAt: { gte: lastPollTime },
              isDeleted: false,
            },
            orderBy: { createdAt: "asc" },
            take: 100,
          });

          let emitted = 0;
          for (const msg of newMessages) {
            if (seenIds.has(msg.id)) continue;
            seenIds.add(msg.id);

            const eventData = {
              id: msg.id,
              channelId: msg.channelId,
              authorId: msg.authorId,
              authorType: msg.authorType,
              content: msg.content,
              type: msg.type,
              streamingStatus: msg.streamingStatus,
              sequence: msg.sequence.toString(),
              createdAt: msg.createdAt.toISOString(),
            };

            const event = `event: message_new\ndata: ${JSON.stringify(eventData)}\n\n`;
            controller.enqueue(encoder.encode(event));
            emitted++;
          }

          if (newMessages.length > 0) {
            lastPollTime = newMessages[newMessages.length - 1].createdAt;
          }

          // Cap seenIds memory — only keep IDs from the last poll window
          if (seenIds.size > 500) {
            const recentIds = new Set(newMessages.map((m) => m.id));
            seenIds.clear();
            for (const id of recentIds) {
              seenIds.add(id);
            }
          }

          // If we hit the limit, there may be more — poll again immediately
          if (emitted >= 100) {
            // Don't wait for next interval; the next tick will pick up remaining rows
          }
        } catch (err) {
          console.error("[v1/agents/events] SSE poll error:", err);
        }
      }, 2000);

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        isClosed = true;
        clearInterval(heartbeat);
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
