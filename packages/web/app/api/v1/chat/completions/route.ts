import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import { authenticateAgentRequest } from "@/lib/agent-auth";
import { broadcastMessageNew } from "@/lib/gateway-client";

/**
 * POST /api/v1/chat/completions — OpenAI-compatible chat completions (DEC-0046)
 *
 * Speaks the OpenAI Chat Completions wire format so any OpenAI SDK,
 * LiteLLM, LangChain, or compatible tool can connect to Tavok.
 *
 * Auth: Authorization: Bearer sk-tvk-...
 *
 * The `model` field encodes the target channel:
 *   - "tavok-channel-{channelId}" — route to specific channel
 *
 * Non-streaming: Injects the last user message into the channel,
 * waits for bot response, returns as OpenAI response format.
 *
 * Streaming: Returns SSE chunks in OpenAI chat.completion.chunk format.
 */
export async function POST(request: NextRequest) {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid or missing API key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid JSON body",
          type: "invalid_request_error",
          code: "invalid_body",
        },
      },
      { status: 400 }
    );
  }

  const { model, messages, stream } = body as {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    stream?: boolean;
  };

  if (!model || typeof model !== "string") {
    return NextResponse.json(
      {
        error: {
          message: "model is required",
          type: "invalid_request_error",
          code: "missing_model",
        },
      },
      { status: 400 }
    );
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      {
        error: {
          message: "messages array is required and must not be empty",
          type: "invalid_request_error",
          code: "missing_messages",
        },
      },
      { status: 400 }
    );
  }

  // Parse model field to extract channelId
  let channelId: string | null = null;
  if (model.startsWith("tavok-channel-")) {
    channelId = model.slice("tavok-channel-".length);
  }

  if (!channelId) {
    return NextResponse.json(
      {
        error: {
          message: `Invalid model format: "${model}". Expected: "tavok-channel-{channelId}"`,
          type: "invalid_request_error",
          code: "invalid_model",
        },
      },
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
      {
        error: {
          message: "Channel not found or not in agent's server",
          type: "invalid_request_error",
          code: "channel_not_found",
        },
      },
      { status: 404 }
    );
  }

  // Extract the last user message
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) {
    return NextResponse.json(
      {
        error: {
          message: "No user message found in messages array",
          type: "invalid_request_error",
          code: "no_user_message",
        },
      },
      { status: 400 }
    );
  }

  // Inject user message into channel
  const userMessageId = ulid();
  const sequence = String(Date.now());
  const completionId = `chatcmpl-${ulid()}`;
  const created = Math.floor(Date.now() / 1000);

  try {
    // Persist and broadcast user message
    const internalUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    await fetch(`${internalUrl}/api/internal/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
      },
      body: JSON.stringify({
        id: userMessageId,
        channelId,
        authorId: agent.botId,
        authorType: "BOT",
        content: lastUserMsg.content,
        type: "STANDARD",
        sequence,
      }),
    }).catch(() => {});

    await broadcastMessageNew(channelId, {
      id: userMessageId,
      channelId,
      authorId: agent.botId,
      authorType: "BOT",
      authorName: agent.botName,
      authorAvatarUrl: agent.botAvatarUrl,
      content: lastUserMsg.content,
      type: "STANDARD",
      streamingStatus: null,
      sequence,
      createdAt: new Date().toISOString(),
    });

    // Wait for bot response by polling messages
    const startTime = Date.now();
    const timeout = 30000; // 30s timeout

    // Poll for bot response
    let botResponse: string | null = null;
    let responseMetadata: Record<string, unknown> = {};

    while (Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check for new bot messages after our user message
      const newMessages = await prisma.message.findMany({
        where: {
          channelId,
          authorType: "BOT",
          authorId: { not: agent.botId }, // Response from another bot
          createdAt: { gt: new Date(startTime) },
          isDeleted: false,
          OR: [
            { streamingStatus: "COMPLETE" },
            { streamingStatus: null },
          ],
          type: { in: ["STANDARD", "STREAMING"] },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      if (newMessages.length > 0) {
        botResponse = newMessages[0].content;
        if (newMessages[0].metadata) {
          responseMetadata = newMessages[0].metadata as Record<string, unknown>;
        }
        break;
      }
    }

    if (!botResponse) {
      return NextResponse.json(
        {
          error: {
            message: "No response received within timeout",
            type: "server_error",
            code: "timeout",
          },
        },
        { status: 504 }
      );
    }

    // Non-streaming response
    if (!stream) {
      return NextResponse.json({
        id: completionId,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: botResponse,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: responseMetadata.tokensIn || 0,
          completion_tokens: responseMetadata.tokensOut || 0,
          total_tokens:
            ((responseMetadata.tokensIn as number) || 0) +
            ((responseMetadata.tokensOut as number) || 0),
        },
      });
    }

    // Streaming response — send as SSE chunks
    const encoder = new TextEncoder();
    const words = botResponse.split(/(\s+)/);

    const sseStream = new ReadableStream({
      start(controller) {
        // Initial chunk with role
        const initialChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initialChunk)}\n\n`)
        );

        // Content chunks
        for (const word of words) {
          const chunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: word },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }

        // Final chunk
        const finalChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat completions failed:", error);
    return NextResponse.json(
      {
        error: {
          message: "Internal server error",
          type: "server_error",
          code: "internal_error",
        },
      },
      { status: 500 }
    );
  }
}
