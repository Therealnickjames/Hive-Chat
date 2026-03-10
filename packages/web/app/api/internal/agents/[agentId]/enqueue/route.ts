import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * POST /api/internal/agents/{agentId}/enqueue — Queue a message for polling (DEC-0043)
 *
 * Called by Gateway when a REST_POLL-type agent is triggered by a message.
 * Inserts a row into the AgentMessage queue table so the agent can pick
 * it up on its next poll of GET /api/v1/agents/{id}/messages.
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

  const { channelId, messageId, content, authorId, authorName, authorType } =
    body as {
      channelId: string;
      messageId: string;
      content: string;
      authorId: string;
      authorName: string;
      authorType: string;
    };

  if (!channelId || !messageId || !content) {
    return NextResponse.json(
      { error: "channelId, messageId, and content are required" },
      { status: 400 },
    );
  }

  try {
    await prisma.agentMessage.create({
      data: {
        id: ulid(),
        agentId,
        channelId,
        messageId,
        content,
        authorId: authorId || "unknown",
        authorName: authorName || "Unknown",
        authorType: authorType || "USER",
        delivered: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Agent message enqueue failed:", error);
    return NextResponse.json(
      { error: "Failed to enqueue message" },
      { status: 500 },
    );
  }
}
