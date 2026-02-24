import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  // Validate internal secret
  const secret = request.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
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
