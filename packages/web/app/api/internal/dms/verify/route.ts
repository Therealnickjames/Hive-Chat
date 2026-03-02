import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/dms/verify — Verify a user is a participant in a DM channel.
 * Called by Gateway on dm:* channel join. (TASK-0019)
 * Query: ?dmId=X&userId=Y
 */
export async function GET(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dmId = searchParams.get("dmId");
  const userId = searchParams.get("userId");

  if (!dmId || !userId) {
    return NextResponse.json(
      { error: "dmId and userId are required" },
      { status: 400 }
    );
  }

  try {
    const participant = await prisma.dmParticipant.findUnique({
      where: {
        dmId_userId: { dmId, userId },
      },
    });

    if (!participant) {
      return NextResponse.json({ valid: false, error: "not_participant" });
    }

    // Also fetch the other participant's info for display
    const otherParticipant = await prisma.dmParticipant.findFirst({
      where: {
        dmId,
        userId: { not: userId },
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json({
      valid: true,
      dmId,
      otherUser: otherParticipant?.user || null,
    });
  } catch (error) {
    console.error("Failed to verify DM participant:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
