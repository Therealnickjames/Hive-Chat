import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import crypto from "crypto";
import { validateInternalSecret } from "@/lib/internal-auth";
import { persistMessage, updateMessage } from "@/lib/internal-api-client";
import {
  broadcastMessageNew,
  broadcastStreamStart,
  broadcastStreamToken,
  broadcastStreamComplete,
  fetchChannelSequence,
} from "@/lib/gateway-client";

import { parseSseChunk } from "@/lib/parse-sse-chunk";
import type { SseTokenEvent } from "@/lib/parse-sse-chunk";

// Re-export for backwards compatibility
export { parseSseChunk };
export type { SseTokenEvent };

/**
 * POST /api/internal/agents/{agentId}/dispatch — Webhook dispatch (DEC-0043)
 *
 * Called by Gateway when a WEBHOOK-type agent is triggered by a message.
 * This endpoint:
 * 1. Loads the agent's webhook URL and signing secret
 * 2. POSTs to the agent's webhook URL with HMAC-SHA256 signature
 * 3. Handles sync response (direct content) or SSE streaming response
 *
 * Auth: X-Internal-Secret header (internal API)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { agentId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const triggerMessageId =
    typeof body.triggerMessageId === "string" ? body.triggerMessageId : "";
  const triggerContent =
    typeof body.triggerContent === "string" ? body.triggerContent : "";
  const contextMessages = Array.isArray(body.contextMessages)
    ? body.contextMessages
    : [];

  if (!channelId || !triggerMessageId) {
    return NextResponse.json(
      { error: "channelId and triggerMessageId are required" },
      { status: 400 },
    );
  }

  // Load agent registration
  const registration = await prisma.agentRegistration.findUnique({
    where: { agentId },
    select: {
      webhookUrl: true,
      webhookSecret: true,
      webhookTimeout: true,
      agent: {
        select: { name: true, avatarUrl: true },
      },
    },
  });

  if (!registration || !registration.webhookUrl) {
    return NextResponse.json(
      { error: "Agent has no webhook URL configured" },
      { status: 404 },
    );
  }

  // Build outbound payload
  const deliveryId = generateId();
  const payload = {
    event: "message",
    timestamp: new Date().toISOString(),
    deliveryId,
    channelId,
    triggerMessage: {
      id: triggerMessageId,
      content: triggerContent,
    },
    contextMessages: contextMessages || [],
  };

  const payloadStr = JSON.stringify(payload);

  // Compute HMAC-SHA256 signature
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tavok-Event": "message",
    "X-Tavok-Delivery": deliveryId,
  };

  if (registration.webhookSecret) {
    const signature = crypto
      .createHmac("sha256", registration.webhookSecret)
      .update(payloadStr)
      .digest("hex");
    headers["X-Tavok-Signature"] = `sha256=${signature}`;
  }

  try {
    // Call agent's webhook URL
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      registration.webhookTimeout || 30000,
    );

    const response = await fetch(registration.webhookUrl, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 202) {
      // Async: agent acknowledged, will respond later via callback
      return NextResponse.json({ ok: true, mode: "async" });
    }

    if (!response.ok) {
      console.error(
        `[internal/dispatch] Webhook dispatch failed: ${response.status}`,
      );
      return NextResponse.json(
        { error: `Agent returned ${response.status}` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "";

    // Handle SSE streaming response
    if (contentType.includes("text/event-stream") && response.body) {
      const messageId = generateId();
      const sequence = await fetchChannelSequence(channelId);

      // Persist streaming placeholder before broadcasting
      await persistMessage({
        id: messageId,
        channelId,
        authorId: agentId,
        authorType: "AGENT",
        content: "",
        type: "STREAMING",
        streamingStatus: "ACTIVE",
        sequence,
      });

      // Broadcast stream_start
      await broadcastStreamStart(channelId, {
        messageId,
        agentId,
        agentName: registration.agent.name,
        agentAvatarUrl: registration.agent.avatarUrl,
        sequence,
      });

      // Read SSE stream and relay tokens
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tokenIndex = 0;
      let fullContent = "";
      let streamCompleted = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const { events, remaining } = parseSseChunk(buffer, chunk);
          buffer = remaining;

          for (const evt of events) {
            if (evt.token) {
              fullContent += evt.token;
              await broadcastStreamToken(channelId, {
                messageId,
                token: evt.token,
                index: tokenIndex++,
              });
            }
            if (evt.done) {
              const resolvedFinalContent = evt.finalContent || fullContent;
              await broadcastStreamComplete(channelId, {
                messageId,
                finalContent: resolvedFinalContent,
                metadata: evt.metadata || null,
              });
              await updateMessage(messageId, {
                content: resolvedFinalContent,
                streamingStatus: "COMPLETE",
                metadata: evt.metadata
                  ? JSON.stringify(evt.metadata)
                  : undefined,
              });
              streamCompleted = true;
            }
          }
        }

        // If stream ended without explicit done, complete it
        if (!streamCompleted && fullContent && tokenIndex > 0) {
          await broadcastStreamComplete(channelId, {
            messageId,
            finalContent: fullContent,
          });
          await updateMessage(messageId, {
            content: fullContent,
            streamingStatus: "COMPLETE",
          });
          streamCompleted = true;
        }
      } catch (streamErr) {
        // Stream read error — persist error state
        console.error("[internal/dispatch] SSE stream read error:", streamErr);
        if (!streamCompleted) {
          await updateMessage(messageId, {
            streamingStatus: "ERROR",
            content: fullContent || "*[Error: Stream read failed]*",
          }).catch((e) =>
            console.error(
              "[internal/dispatch] Failed to persist stream error:",
              e,
            ),
          );
        }
      } finally {
        reader.releaseLock();
      }

      return NextResponse.json({ ok: true, mode: "stream", messageId });
    }

    // Handle sync JSON response
    const responseBody = await response.json().catch(() => null);
    if (responseBody?.content) {
      const messageId = generateId();
      const sequence = await fetchChannelSequence(channelId);

      // Persist first, then broadcast (matches streaming path order)
      await persistMessage({
        id: messageId,
        channelId,
        authorId: agentId,
        authorType: "AGENT",
        content: responseBody.content,
        type: "STANDARD",
        sequence,
      });

      await broadcastMessageNew(channelId, {
        id: messageId,
        channelId,
        authorId: agentId,
        authorType: "AGENT",
        authorName: registration.agent.name,
        authorAvatarUrl: registration.agent.avatarUrl,
        content: responseBody.content,
        type: "STANDARD",
        streamingStatus: null,
        sequence,
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true, mode: "sync", messageId });
    }

    return NextResponse.json({ ok: true, mode: "empty" });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return NextResponse.json({ error: "Webhook timed out" }, { status: 504 });
    }
    console.error("[internal/dispatch] Webhook dispatch error:", error);
    return NextResponse.json(
      { error: "Webhook dispatch failed" },
      { status: 502 },
    );
  }
}
