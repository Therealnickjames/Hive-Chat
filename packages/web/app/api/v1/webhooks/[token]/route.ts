import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import {
  broadcastMessageNew,
  broadcastStreamStart,
  broadcastTypedMessage,
} from "@/lib/gateway-client";

/**
 * POST /api/v1/webhooks/{token} — Send a message via inbound webhook (DEC-0045)
 *
 * No auth header required. The token in the URL IS the authentication.
 * Identical to Discord's incoming webhook pattern.
 *
 * Simple message:
 *   POST /api/v1/webhooks/whk_...
 *   {"content": "Build #1234 passed"}
 *
 * Start streaming:
 *   POST /api/v1/webhooks/whk_...
 *   {"streaming": true}
 *   → Returns {messageId, streamUrl}
 *
 * Typed message (tool call, code block, etc.):
 *   POST /api/v1/webhooks/whk_...
 *   {"type": "TOOL_CALL", "content": {"callId": "...", "toolName": "...", ...}}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Look up webhook by token (indexed query)
  const webhook = await prisma.inboundWebhook.findUnique({
    where: { token },
    select: {
      id: true,
      channelId: true,
      botId: true,
      name: true,
      avatarUrl: true,
      isActive: true,
    },
  });

  if (!webhook) {
    return NextResponse.json(
      { error: "Invalid webhook token" },
      { status: 404 }
    );
  }

  if (!webhook.isActive) {
    return NextResponse.json(
      { error: "Webhook is disabled" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const {
    content,
    streaming,
    username,
    avatarUrl: overrideAvatar,
    type: msgType,
  } = body as {
    content?: string;
    streaming?: boolean;
    username?: string;
    avatarUrl?: string;
    type?: string;
  };

  // Resolve display name/avatar (allow per-message overrides like Discord)
  const displayName = (username as string) || webhook.name;
  const displayAvatar = (overrideAvatar as string) || webhook.avatarUrl;

  const messageId = ulid();

  // Get next sequence via internal API
  const sequenceResponse = await fetch(
    `${process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_WEB_URL || "http://gateway:4001"}/api/internal/sequence?channelId=${webhook.channelId}`,
    {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET || "" },
    }
  ).catch(() => null);

  // Fallback: use timestamp-based sequence if gateway is unavailable
  let sequence = String(Date.now());
  if (sequenceResponse?.ok) {
    const seqData = await sequenceResponse.json();
    sequence = String(seqData.sequence);
  }

  try {
    // Handle typed messages (TOOL_CALL, TOOL_RESULT, CODE_BLOCK, etc.)
    const validTypedTypes = ["TOOL_CALL", "TOOL_RESULT", "CODE_BLOCK", "ARTIFACT", "STATUS"];
    if (msgType && validTypedTypes.includes(msgType)) {
      const typedContent = body.content;

      // Persist message
      await persistMessage({
        id: messageId,
        channelId: webhook.channelId,
        authorId: webhook.botId,
        authorType: "BOT",
        content: typeof typedContent === "string"
          ? typedContent
          : JSON.stringify(typedContent),
        type: msgType,
        sequence,
      });

      // Broadcast typed_message
      await broadcastTypedMessage(webhook.channelId, {
        id: messageId,
        channelId: webhook.channelId,
        authorId: webhook.botId,
        authorType: "BOT",
        authorName: displayName,
        authorAvatarUrl: displayAvatar,
        content: typeof typedContent === "string"
          ? typedContent
          : JSON.stringify(typedContent),
        type: msgType,
        sequence,
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ messageId, sequence });
    }

    // Handle streaming initiation
    if (streaming) {
      // Persist placeholder
      await persistMessage({
        id: messageId,
        channelId: webhook.channelId,
        authorId: webhook.botId,
        authorType: "BOT",
        content: "",
        type: "STREAMING",
        streamingStatus: "ACTIVE",
        sequence,
      });

      // Broadcast stream_start
      await broadcastStreamStart(webhook.channelId, {
        messageId,
        botId: webhook.botId,
        botName: displayName,
        botAvatarUrl: displayAvatar,
        sequence,
      });

      const webUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

      return NextResponse.json(
        {
          messageId,
          sequence,
          streamUrl: `${webUrl}/api/v1/webhooks/${token}/stream`,
        },
        { status: 201 }
      );
    }

    // Handle simple message
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "content is required (or use streaming: true)" },
        { status: 400 }
      );
    }

    // Persist message
    await persistMessage({
      id: messageId,
      channelId: webhook.channelId,
      authorId: webhook.botId,
      authorType: "BOT",
      content,
      type: "STANDARD",
      sequence,
    });

    // Broadcast message_new
    await broadcastMessageNew(webhook.channelId, {
      id: messageId,
      channelId: webhook.channelId,
      authorId: webhook.botId,
      authorType: "BOT",
      authorName: displayName,
      authorAvatarUrl: displayAvatar,
      content,
      type: "STANDARD",
      streamingStatus: null,
      sequence,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ messageId, sequence });
  } catch (error) {
    console.error("Webhook message failed:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}

/**
 * Persist a message via the internal API.
 */
async function persistMessage(data: {
  id: string;
  channelId: string;
  authorId: string;
  authorType: string;
  content: string;
  type: string;
  streamingStatus?: string;
  sequence: string;
}) {
  const internalUrl =
    process.env.NEXTAUTH_URL || "http://localhost:3000";

  const response = await fetch(`${internalUrl}/api/internal/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok && response.status !== 409) {
    // 409 = duplicate (idempotency guard) — treated as success
    const errorBody = await response.text().catch(() => "unknown");
    console.error(
      `Message persistence failed: ${response.status} ${errorBody}`
    );
  }
}
