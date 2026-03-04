import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * PATCH /api/internal/dms/messages/{messageId} — Edit a DM message.
 * Called by Gateway when a user edits their DM message. (TASK-0019)
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

  const { content } = body;

  if (typeof content !== "string" || content.trim() === "") {
    return NextResponse.json(
      { error: "content is required and must be non-empty" },
      { status: 400 },
    );
  }

  try {
    const message = await prisma.directMessage.update({
      where: { id: messageId },
      data: {
        content,
        editedAt: new Date(),
      },
    });

    return NextResponse.json({
      id: message.id,
      content: message.content,
      editedAt: message.editedAt?.toISOString(),
    });
  } catch (error) {
    console.error("Failed to edit DM message:", error);
    return NextResponse.json(
      { error: "Failed to edit message" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/internal/dms/messages/{messageId} — Soft-delete a DM message.
 * Called by Gateway when a user deletes their DM message. (TASK-0019)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    await prisma.directMessage.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    return NextResponse.json({ id: messageId, deleted: true });
  } catch (error) {
    console.error("Failed to delete DM message:", error);
    return NextResponse.json(
      { error: "Failed to delete message" },
      { status: 500 },
    );
  }
}
