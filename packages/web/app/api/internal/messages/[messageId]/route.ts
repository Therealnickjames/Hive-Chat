import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/messages/{messageId}
 *
 * Fetch one message by id for internal consumers (Gateway watchdog).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        channelId: true,
        content: true,
        type: true,
        streamingStatus: true,
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json(message);
  } catch (error) {
    console.error("[Internal] Failed to fetch message:", error);
    return NextResponse.json(
      { error: "Failed to fetch message" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/internal/messages/{messageId}
 *
 * Update a streaming message on completion or error.
 * Used by the Go Proxy to finalize placeholder messages.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  const body = await request.json();
  const { content, streamingStatus } = body;

  if (!content && content !== "" && !streamingStatus) {
    return NextResponse.json(
      { error: "Must provide content or streamingStatus" },
      { status: 400 }
    );
  }

  try {
    const updateData: Record<string, unknown> = {};
    if (content !== undefined) updateData.content = content;
    if (streamingStatus) updateData.streamingStatus = streamingStatus;

    const message = await prisma.message.update({
      where: { id: messageId },
      data: updateData,
    });

    return NextResponse.json({
      id: message.id,
      content: message.content,
      streamingStatus: message.streamingStatus,
    });
  } catch (error) {
    console.error("[Internal] Failed to update message:", error);
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 }
    );
  }
}
