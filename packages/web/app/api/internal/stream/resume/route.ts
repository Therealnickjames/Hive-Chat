import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * POST /api/internal/stream/resume
 *
 * Validate a checkpoint resume request and return the partial content
 * up to the checkpoint offset. The actual new streaming message is created
 * by the Gateway via the normal stream_start flow. (TASK-0021)
 *
 * Body: { channelId, originalMessageId, checkpointIndex, botId }
 * Returns: { originalMessageId, channelId, botId, botName, checkpointIndex, partialContent }
 */
export async function POST(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelId, originalMessageId, checkpointIndex, botId } = body;

  if (
    !channelId ||
    !originalMessageId ||
    checkpointIndex === undefined ||
    !botId
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: channelId, originalMessageId, checkpointIndex, botId",
      },
      { status: 400 },
    );
  }

  try {
    // Validate original message exists and has checkpoints
    const originalMessage = await prisma.message.findUnique({
      where: { id: originalMessageId },
      select: {
        id: true,
        channelId: true,
        content: true,
        checkpoints: true,
        streamingStatus: true,
      },
    });

    if (!originalMessage) {
      return NextResponse.json(
        { error: "Original message not found" },
        { status: 404 },
      );
    }

    if (!originalMessage.checkpoints) {
      return NextResponse.json(
        { error: "Original message has no checkpoints" },
        { status: 400 },
      );
    }

    const parsedCheckpoints = JSON.parse(originalMessage.checkpoints);
    if (
      !Array.isArray(parsedCheckpoints) ||
      checkpointIndex >= parsedCheckpoints.length
    ) {
      return NextResponse.json(
        { error: "Invalid checkpoint index" },
        { status: 400 },
      );
    }

    // Validate bot exists
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { id: true, name: true, isActive: true },
    });

    if (!bot || !bot.isActive) {
      return NextResponse.json(
        { error: "Bot not found or inactive" },
        { status: 404 },
      );
    }

    // Extract partial content up to checkpoint offset
    const checkpoint = parsedCheckpoints[checkpointIndex];
    const partialContent =
      originalMessage.content?.substring(0, checkpoint.contentOffset) || "";

    return NextResponse.json({
      originalMessageId,
      channelId,
      botId,
      botName: bot.name,
      checkpointIndex,
      checkpointLabel: checkpoint.label,
      partialContent,
    });
  } catch (error) {
    console.error("[Internal] Failed to validate resume request:", error);
    return NextResponse.json(
      { error: "Failed to validate resume request" },
      { status: 500 },
    );
  }
}
