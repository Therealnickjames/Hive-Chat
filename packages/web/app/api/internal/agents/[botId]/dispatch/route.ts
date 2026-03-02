import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import crypto from "crypto";
import { validateInternalSecret } from "@/lib/internal-auth";
import {
  broadcastMessageNew,
  broadcastStreamStart,
  broadcastStreamToken,
  broadcastStreamComplete,
} from "@/lib/gateway-client";

/**
 * POST /api/internal/agents/{botId}/dispatch — Webhook dispatch (DEC-0043)
 *
 * Called by Gateway when a WEBHOOK-type bot is triggered by a message.
 * This endpoint:
 * 1. Loads the agent's webhook URL and signing secret
 * 2. POSTs to the agent's webhook URL with HMAC-SHA256 signature
 * 3. Handles sync response (direct content) or SSE streaming response
 *
 * Auth: X-Internal-Secret header (internal API)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ botId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelId, triggerMessageId, triggerContent, contextMessages } =
    body as {
      channelId: string;
      triggerMessageId: string;
      triggerContent: string;
      contextMessages: Array<{ role: string; content: string }>;
    };

  // Load agent registration
  const registration = await prisma.agentRegistration.findUnique({
    where: { botId },
    select: {
      webhookUrl: true,
      webhookSecret: true,
      webhookTimeout: true,
      bot: {
        select: { name: true, avatarUrl: true },
      },
    },
  });

  if (!registration || !registration.webhookUrl) {
    return NextResponse.json(
      { error: "Agent has no webhook URL configured" },
      { status: 404 }
    );
  }

  // Build outbound payload
  const deliveryId = ulid();
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
      registration.webhookTimeout || 30000
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
      console.error(`Webhook dispatch failed: ${response.status}`);
      return NextResponse.json(
        { error: `Agent returned ${response.status}` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") || "";

    // Handle SSE streaming response
    if (contentType.includes("text/event-stream") && response.body) {
      const messageId = ulid();
      const sequence = String(Date.now()); // fallback sequence

      // Broadcast stream_start
      await broadcastStreamStart(channelId, {
        messageId,
        botId,
        botName: registration.bot.name,
        botAvatarUrl: registration.bot.avatarUrl,
        sequence,
      });

      // Read SSE stream and relay tokens
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tokenIndex = 0;
      let fullContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.token) {
                  fullContent += parsed.token;
                  await broadcastStreamToken(channelId, {
                    messageId,
                    token: parsed.token,
                    index: tokenIndex++,
                  });
                }
                if (parsed.done) {
                  await broadcastStreamComplete(channelId, {
                    messageId,
                    finalContent: parsed.finalContent || fullContent,
                    metadata: parsed.metadata || null,
                  });
                }
              } catch {
                // Skip malformed SSE data
              }
            }
          }
        }

        // If stream ended without explicit done, complete it
        if (fullContent && tokenIndex > 0) {
          await broadcastStreamComplete(channelId, {
            messageId,
            finalContent: fullContent,
          });
        }
      } finally {
        reader.releaseLock();
      }

      return NextResponse.json({ ok: true, mode: "stream", messageId });
    }

    // Handle sync JSON response
    const responseBody = await response.json().catch(() => null);
    if (responseBody?.content) {
      const messageId = ulid();
      const sequence = String(Date.now());

      // Persist and broadcast
      await broadcastMessageNew(channelId, {
        id: messageId,
        channelId,
        authorId: botId,
        authorType: "BOT",
        authorName: registration.bot.name,
        authorAvatarUrl: registration.bot.avatarUrl,
        content: responseBody.content,
        type: "STANDARD",
        streamingStatus: null,
        sequence,
        createdAt: new Date().toISOString(),
      });

      // Persist via internal API
      const internalUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      await fetch(`${internalUrl}/api/internal/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          id: messageId,
          channelId,
          authorId: botId,
          authorType: "BOT",
          content: responseBody.content,
          type: "STANDARD",
          sequence,
        }),
      }).catch((err) => console.error("Persist failed:", err));

      return NextResponse.json({ ok: true, mode: "sync", messageId });
    }

    return NextResponse.json({ ok: true, mode: "empty" });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return NextResponse.json(
        { error: "Webhook timed out" },
        { status: 504 }
      );
    }
    console.error("Webhook dispatch error:", error);
    return NextResponse.json(
      { error: "Webhook dispatch failed" },
      { status: 502 }
    );
  }
}
