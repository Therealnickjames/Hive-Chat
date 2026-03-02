import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeSequence } from "@/lib/api-safety";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/channels/{channelId}
 *
 * Returns:
 * - channel metadata for gateway authorization and sequence recovery
 * - optional membership check when `userId` query param is provided
 *
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        serverId: true,
        lastSequence: true,
        // Charter fields (TASK-0020)
        swarmMode: true,
        charterGoal: true,
        charterRules: true,
        charterAgentOrder: true,
        charterMaxTurns: true,
        charterCurrentTurn: true,
        charterStatus: true,
      },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Parse charterAgentOrder JSON string → array
    let charterAgentOrder: string[] | null = null;
    if (channel.charterAgentOrder) {
      try {
        charterAgentOrder = JSON.parse(channel.charterAgentOrder);
      } catch {
        charterAgentOrder = null;
      }
    }

    const response: Record<string, unknown> = {
      channelId: channel.id,
      serverId: channel.serverId,
      lastSequence: serializeSequence(channel.lastSequence),
      // Charter fields (TASK-0020)
      swarmMode: channel.swarmMode,
      charterGoal: channel.charterGoal,
      charterRules: channel.charterRules,
      charterAgentOrder,
      charterMaxTurns: channel.charterMaxTurns,
      charterCurrentTurn: channel.charterCurrentTurn,
      charterStatus: channel.charterStatus,
    };

    if (userId) {
      const member = await prisma.member.findUnique({
        where: {
          userId_serverId: {
            userId,
            serverId: channel.serverId,
          },
        },
      });

      response.isMember = !!member;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to load internal channel:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
