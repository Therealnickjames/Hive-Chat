import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * POST /api/internal/channels/{channelId}/charter-turn
 *
 * Increments charterCurrentTurn by 1. Called by Go proxy after stream completes.
 * If charterCurrentTurn >= charterMaxTurns (and maxTurns > 0), auto-sets
 * charterStatus to COMPLETED.
 *
 * Auth: x-internal-secret header (TASK-0020).
 *
 * Returns: { currentTurn, maxTurns, completed }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    // Atomically increment the turn counter
    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        charterCurrentTurn: { increment: 1 },
      },
      select: {
        charterCurrentTurn: true,
        charterMaxTurns: true,
        charterStatus: true,
      },
    });

    let completed = false;

    // Auto-complete if max turns reached (and maxTurns > 0)
    if (
      channel.charterMaxTurns > 0 &&
      channel.charterCurrentTurn >= channel.charterMaxTurns &&
      channel.charterStatus === "ACTIVE"
    ) {
      await prisma.channel.update({
        where: { id: channelId },
        data: { charterStatus: "COMPLETED" },
      });
      completed = true;
    }

    return NextResponse.json({
      currentTurn: channel.charterCurrentTurn,
      maxTurns: channel.charterMaxTurns,
      completed,
    });
  } catch (error) {
    console.error("Failed to increment charter turn:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
