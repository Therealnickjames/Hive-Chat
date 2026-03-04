import { NextRequest, NextResponse } from "next/server";
import { authenticateAgentRequest } from "@/lib/agent-auth";
import {
  broadcastStreamToken,
  broadcastStreamComplete,
  broadcastStreamError,
  broadcastToChannel,
} from "@/lib/gateway-client";

/**
 * POST /api/v1/agents/{id}/messages/{messageId}/stream — Stream tokens (DEC-0043)
 *
 * Auth: Authorization: Bearer sk-tvk-...
 *
 * Send tokens: {"tokens": ["Hello ", "world!"], "done": false}
 * Complete:    {"tokens": ["last"], "done": true, "finalContent": "...", "metadata": {...}}
 * Thinking:    {"thinking": {"phase": "Searching", "detail": "..."}}
 * Error:       {"error": "Something went wrong"}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id: agentId, messageId } = await params;

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

  const { tokens, done, finalContent, metadata, thinking, error, channelId } =
    body as {
      tokens?: string[];
      done?: boolean;
      finalContent?: string;
      metadata?: Record<string, unknown>;
      thinking?: { phase: string; detail?: string };
      error?: string;
      channelId?: string;
    };

  // We need channelId to broadcast. Try to get it from the request or message lookup.
  const resolvedChannelId = channelId || "";

  if (!resolvedChannelId) {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  try {
    // Handle error
    if (error) {
      await broadcastStreamError(resolvedChannelId, {
        messageId,
        error,
        partialContent: finalContent || null,
      });

      await updateMessage(messageId, {
        streamingStatus: "ERROR",
        content: finalContent || `*[Error: ${error}]*`,
      });

      return NextResponse.json({ ok: true });
    }

    // Handle thinking
    if (thinking) {
      await broadcastToChannel(
        `room:${resolvedChannelId}`,
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

    // Broadcast tokens
    let tokenIndex = 0;
    if (tokens && Array.isArray(tokens)) {
      for (const tokenText of tokens) {
        await broadcastStreamToken(resolvedChannelId, {
          messageId,
          token: tokenText,
          index: tokenIndex++,
        });
      }
    }

    // Handle completion
    if (done) {
      const resolvedContent = finalContent || (tokens ? tokens.join("") : "");

      await broadcastStreamComplete(resolvedChannelId, {
        messageId,
        finalContent: resolvedContent,
        metadata: metadata || null,
      });

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
    console.error("Agent stream failed:", err);
    return NextResponse.json(
      { error: "Failed to process stream" },
      { status: 500 }
    );
  }
}

async function updateMessage(messageId: string, data: Record<string, unknown>) {
  const internalUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  await fetch(`${internalUrl}/api/internal/messages/${messageId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
    },
    body: JSON.stringify(data),
  }).catch((err) => console.error("Update failed:", err));
}
