import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id: agentId, messageId } = await params;

  const agent = await authenticateAgentRequest(request);
  if (!agent || agent.agentId !== agentId) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tokens, done, finalContent, metadata, thinking, error, tokenOffset } =
    body as {
      tokens?: string[];
      done?: boolean;
      finalContent?: string;
      metadata?: Record<string, unknown>;
      thinking?: { phase: string; detail?: string };
      error?: string;
      tokenOffset?: number;
    };

  // Verify message ownership and resolve channelId from DB (not from request body)
  const ownership = await verifyMessageOwnership(messageId, agent.agentId);
  if (!ownership.valid) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status },
    );
  }

  const resolvedChannelId = ownership.channelId;

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
      await broadcastToChannel(`room:${resolvedChannelId}`, "stream_thinking", {
        messageId,
        phase: thinking.phase,
        detail: thinking.detail || null,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true });
    }

    // Broadcast tokens — use caller-supplied offset for cross-batch monotonicity
    let tokenIndex = typeof tokenOffset === "number" ? tokenOffset : 0;
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
        nextTokenOffset: tokenIndex,
        completed: true,
      });
    }

    return NextResponse.json({
      ok: true,
      tokensReceived: tokens?.length || 0,
      nextTokenOffset: tokenIndex,
    });
  } catch (err) {
    console.error("Agent stream failed:", err);
    return NextResponse.json(
      { error: "Failed to process stream" },
      { status: 500 },
    );
  }
}

async function verifyMessageOwnership(
  messageId: string,
  agentId: string,
): Promise<
  | { valid: true; channelId: string }
  | { valid: false; error: string; status: number }
> {
  let message;
  try {
    message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        channelId: true,
        authorId: true,
        streamingStatus: true,
        isDeleted: true,
      },
    });
  } catch (err) {
    console.error("Ownership check DB query failed:", err);
    return {
      valid: false,
      error: "Internal error during ownership verification",
      status: 500,
    };
  }

  if (!message || message.isDeleted) {
    return { valid: false, error: "Message not found", status: 404 };
  }

  if (message.authorId !== agentId) {
    return {
      valid: false,
      error: "Message does not belong to this agent",
      status: 403,
    };
  }

  if (message.streamingStatus !== "ACTIVE") {
    return {
      valid: false,
      error: "Message is not in active streaming state",
      status: 409,
    };
  }

  return { valid: true, channelId: message.channelId };
}

async function updateMessage(messageId: string, data: Record<string, unknown>) {
  const internalUrl = process.env.NEXTAUTH_URL || "http://localhost:5555";
  await fetch(`${internalUrl}/api/internal/messages/${messageId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
    },
    body: JSON.stringify(data),
  }).catch((err) => console.error("Update failed:", err));
}
