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
 * Body: { channelId, originalMessageId, checkpointIndex, agentId }
 * Returns: { originalMessageId, channelId, agentId, agentName, checkpointIndex, partialContent }
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

  const { channelId, originalMessageId, checkpointIndex, agentId } = body;

  if (
    !channelId ||
    !originalMessageId ||
    checkpointIndex === undefined ||
    !agentId
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: channelId, originalMessageId, checkpointIndex, agentId",
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

    // Validate agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, isActive: true },
    });

    if (!agent || !agent.isActive) {
      return NextResponse.json(
        { error: "Agent not found or inactive" },
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
      agentId,
      agentName: agent.name,
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
