import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";
import {
  computeMemberPermissions,
  hasPermission,
  Permissions,
} from "@/lib/permissions";

/**
 * GET /api/internal/messages/{messageId}
 *
 * Fetch one message by id for internal consumers (Gateway watchdog).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
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
      { status: 500 },
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
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  const body = await request.json();
  const {
    content,
    streamingStatus,
    thinkingTimeline,
    metadata,
    tokenHistory,
    checkpoints,
  } = body;

  if (!content && content !== "" && !streamingStatus) {
    return NextResponse.json(
      { error: "Must provide content or streamingStatus" },
      { status: 400 },
    );
  }

  try {
    const updateData: Record<string, unknown> = {};
    if (content !== undefined) updateData.content = content;
    if (streamingStatus) updateData.streamingStatus = streamingStatus;
    if (thinkingTimeline) updateData.thinkingTimeline = thinkingTimeline; // TASK-0011
    if (metadata) updateData.metadata = metadata; // TASK-0039: Agent execution metadata
    if (tokenHistory) updateData.tokenHistory = tokenHistory; // TASK-0021: Stream rewind data
    if (checkpoints) updateData.checkpoints = checkpoints; // TASK-0021: Checkpoint resume data

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
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/internal/messages/{messageId}
 *
 * Edit a message's content. Only the author can edit.
 * Called by Gateway on message_edit WebSocket event. (TASK-0014)
 *
 * Body: { userId: string, content: string }
 * Returns: { messageId, content, editedAt } (200)
 * Errors: 400 (bad input), 403 (not author / bot message), 404, 409 (active stream)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, content } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!content || typeof content !== "string" || content.trim() === "") {
    return NextResponse.json(
      { error: "content must be a non-empty string" },
      { status: 400 },
    );
  }
  if (content.length > 4000) {
    return NextResponse.json(
      { error: "content exceeds 4000 character limit" },
      { status: 400 },
    );
  }

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        authorId: true,
        authorType: true,
        streamingStatus: true,
        isDeleted: true,
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.isDeleted) {
      return NextResponse.json(
        { error: "Cannot edit a deleted message" },
        { status: 404 },
      );
    }

    if (message.authorType === "BOT") {
      return NextResponse.json(
        { error: "Cannot edit bot messages" },
        { status: 403 },
      );
    }

    if (message.authorId !== userId) {
      return NextResponse.json(
        { error: "Only the author can edit this message" },
        { status: 403 },
      );
    }

    if (message.streamingStatus === "ACTIVE") {
      return NextResponse.json(
        { error: "Cannot edit an active streaming message" },
        { status: 409 },
      );
    }

    const editedAt = new Date();
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt },
    });

    return NextResponse.json({
      messageId: updated.id,
      content: updated.content,
      editedAt: editedAt.toISOString(),
    });
  } catch (error) {
    console.error("[Internal] Failed to edit message:", error);
    return NextResponse.json(
      { error: "Failed to edit message" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/internal/messages/{messageId}
 *
 * Soft-delete a message. Author can delete own messages.
 * Users with MANAGE_MESSAGES permission can delete any message.
 * Called by Gateway on message_delete WebSocket event. (TASK-0014)
 *
 * Body: { userId: string }
 * Returns: { messageId, deletedBy } (200)
 * Errors: 403 (unauthorized), 404 (not found or already deleted)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        authorId: true,
        isDeleted: true,
        channel: {
          select: { serverId: true },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.isDeleted) {
      return NextResponse.json(
        { error: "Message already deleted" },
        { status: 404 },
      );
    }

    // Author can always delete own messages
    const isAuthor = message.authorId === userId;

    if (!isAuthor) {
      // Check MANAGE_MESSAGES permission for deleting others' messages
      const member = await prisma.member.findUnique({
        where: {
          userId_serverId: { userId, serverId: message.channel.serverId },
        },
        include: {
          roles: { select: { permissions: true } },
          server: { select: { ownerId: true } },
        },
      });

      if (!member) {
        return NextResponse.json(
          { error: "Not a server member" },
          { status: 403 },
        );
      }

      const effectivePermissions = computeMemberPermissions(
        userId,
        member.server.ownerId,
        member.roles,
      );

      if (!hasPermission(effectivePermissions, Permissions.MANAGE_MESSAGES)) {
        return NextResponse.json(
          { error: "Missing MANAGE_MESSAGES permission" },
          { status: 403 },
        );
      }
    }

    await prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    return NextResponse.json({
      messageId: message.id,
      deletedBy: userId,
    });
  } catch (error) {
    console.error("[Internal] Failed to delete message:", error);
    return NextResponse.json(
      { error: "Failed to delete message" },
      { status: 500 },
    );
  }
}
