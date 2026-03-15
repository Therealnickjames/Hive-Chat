import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishStreamResume } from "@/lib/gateway-client";

/**
 * POST /api/stream/resume — User-facing stream resume endpoint (TASK-0021)
 *
 * Validates checkpoint, then publishes a resume request to the Gateway
 * which forwards it to Redis for the Go streaming proxy.
 *
 * Body: { messageId, checkpointIndex, agentId }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messageId, checkpointIndex, agentId } = body;

  if (!messageId || checkpointIndex === undefined || !agentId) {
    return NextResponse.json(
      { error: "Missing required fields: messageId, checkpointIndex, agentId" },
      { status: 400 },
    );
  }

  try {
    // Validate original message exists and has checkpoints
    const originalMessage = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        channelId: true,
        content: true,
        checkpoints: true,
        streamingStatus: true,
      },
    });

    if (!originalMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (!originalMessage.checkpoints) {
      return NextResponse.json(
        { error: "Message has no checkpoints" },
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

    // Validate agent exists and is active
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

    // Extract partial content up to checkpoint
    const checkpoint = parsedCheckpoints[checkpointIndex];
    const partialContent =
      originalMessage.content?.substring(0, checkpoint.contentOffset) || "";

    // Publish resume request to Gateway → Redis → Go proxy
    await publishStreamResume({
      channelId: originalMessage.channelId,
      originalMessageId: messageId,
      agentId,
      agentName: agent.name,
      checkpointIndex,
      checkpointLabel: checkpoint.label,
      partialContent,
    });

    return NextResponse.json({
      ok: true,
      channelId: originalMessage.channelId,
      checkpointLabel: checkpoint.label,
    });
  } catch (error) {
    console.error("[stream/resume] Failed to process resume request:", error);
    return NextResponse.json(
      { error: "Failed to process resume request" },
      { status: 500 },
    );
  }
}
