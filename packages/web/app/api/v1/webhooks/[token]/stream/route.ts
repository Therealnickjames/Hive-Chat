import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  broadcastStreamToken,
  broadcastStreamComplete,
  broadcastStreamError,
  broadcastToChannel,
} from "@/lib/gateway-client";

/**
 * POST /api/v1/webhooks/{token}/stream — Send streaming tokens (DEC-0045)
 *
 * No auth header required. The token in the URL IS the authentication.
 *
 * Send tokens (not final):
 *   {"messageId": "01HXY...", "tokens": ["Hello ", "world!"], "done": false}
 *
 * Final batch with completion:
 *   {"messageId": "01HXY...", "tokens": ["last tokens"], "done": true,
 *    "finalContent": "Full message content", "metadata": {...}}
 *
 * Send thinking/status update:
 *   {"messageId": "01HXY...", "thinking": {"phase": "Searching", "detail": "..."}}
 *
 * Send error:
 *   {"messageId": "01HXY...", "error": "Something went wrong"}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Verify webhook token
  const webhook = await prisma.inboundWebhook.findUnique({
    where: { token },
    select: { channelId: true, isActive: true },
  });

  if (!webhook || !webhook.isActive) {
    return NextResponse.json(
      { error: "Invalid or disabled webhook" },
      { status: 404 }
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

  const { messageId, tokens, done, finalContent, metadata, thinking, error } =
    body as {
      messageId?: string;
      tokens?: string[];
      done?: boolean;
      finalContent?: string;
      metadata?: Record<string, unknown>;
      thinking?: { phase: string; detail?: string };
      error?: string;
    };

  if (!messageId || typeof messageId !== "string") {
    return NextResponse.json(
      { error: "messageId is required" },
      { status: 400 }
    );
  }

  try {
    // Handle error
    if (error) {
      await broadcastStreamError(webhook.channelId, {
        messageId,
        error,
        partialContent: (finalContent as string) || null,
      });

      // Persist error state
      await updateMessage(messageId, {
        streamingStatus: "ERROR",
        content: (finalContent as string) || `*[Error: ${error}]*`,
      });

      return NextResponse.json({ ok: true });
    }

    // Handle thinking/status updates
    if (thinking) {
      await broadcastToChannel(
        `room:${webhook.channelId}`,
        "stream_thinking",
        {
          messageId,
          phase: thinking.phase,
          detail: thinking.detail || null,
          timestamp: new Date().toISOString(),
        }
      );
      return NextResponse.json({ ok: true });
    }

    // Broadcast each token
    let tokenIndex = 0;
    if (tokens && Array.isArray(tokens)) {
      for (const tokenText of tokens) {
        await broadcastStreamToken(webhook.channelId, {
          messageId,
          token: tokenText,
          index: tokenIndex++,
        });
      }
    }

    // Handle completion
    if (done) {
      const resolvedContent =
        (finalContent as string) ||
        (tokens ? tokens.join("") : "");

      await broadcastStreamComplete(webhook.channelId, {
        messageId,
        finalContent: resolvedContent,
        metadata: metadata || null,
      });

      // Persist completed message
      await updateMessage(messageId, {
        content: resolvedContent,
        streamingStatus: "COMPLETE",
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      });

      return NextResponse.json({
        ok: true,
        tokensReceived: tokens?.length || 0,
        completed: true,
      });
    }

    return NextResponse.json({
      ok: true,
      tokensReceived: tokens?.length || 0,
    });
  } catch (err) {
    console.error("Webhook stream failed:", err);
    return NextResponse.json(
      { error: "Failed to process stream" },
      { status: 500 }
    );
  }
}

/**
 * Update a message via the internal API.
 */
async function updateMessage(
  messageId: string,
  data: Record<string, unknown>
) {
  const internalUrl =
    process.env.NEXTAUTH_URL || "http://localhost:3000";

  const response = await fetch(
    `${internalUrl}/api/internal/messages/${messageId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown");
    console.error(
      `Message update failed: ${response.status} ${errorBody}`
    );
  }
}
