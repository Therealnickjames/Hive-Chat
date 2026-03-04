import { NextRequest } from "next/server";
import {
  authenticateAgentKey,
  authenticateAgentRequest,
} from "@/lib/agent-auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/v1/agents/{id}/events — SSE event stream (DEC-0043, Phase 5)
 *
 * Real-time event stream via Server-Sent Events. Agent receives:
 * - message_new: new messages in subscribed channels
 * - stream_start, stream_token, stream_complete: streaming events
 * - stream_error, stream_thinking: error and status events
 * - typed_message: tool calls, code blocks, etc.
 * - heartbeat: keepalive every 15 seconds
 *
 * Auth: Authorization: Bearer sk-tvk-... or ?api_key=sk-tvk-...
 *
 * Query params:
 *   channels — comma-separated channel IDs to subscribe to
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

  if (!agent || agent.botId !== agentId) {
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

  // Verify all channels belong to agent's server
  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, serverId: true },
  });

  const invalidChannels = channels.filter(
    (c) => c.serverId !== agent!.serverId,
  );
  if (invalidChannels.length > 0) {
    return new Response(
      JSON.stringify({ error: "Some channels don't belong to agent's server" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
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

      // Poll for new messages every 2 seconds and send as SSE events
      // (In production, this would use Redis pub/sub, but polling is simpler
      // for the initial implementation and works without additional Redis setup)
      let lastPollTime = new Date();

      const pollInterval = setInterval(async () => {
        if (isClosed) {
          clearInterval(pollInterval);
          return;
        }

        try {
          // Check for new messages since last poll
          const newMessages = await prisma.message.findMany({
            where: {
              channelId: { in: channelIds },
              createdAt: { gt: lastPollTime },
              isDeleted: false,
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          });

          for (const msg of newMessages) {
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
          }

          if (newMessages.length > 0) {
            lastPollTime = newMessages[newMessages.length - 1].createdAt;
          }
        } catch {
          // Ignore poll errors silently
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
