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
  { params }: { params: Promise<{ channelId: string }> },
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

/**
 * PUT /api/internal/channels/{channelId}/charter-turn
 *
 * Atomic turn claim for ordered charter modes. Called by Go proxy at stream
 * start to atomically verify and reserve a turn, preventing the TOCTOU race
 * where two concurrent streams both pass the turn check on a stale snapshot.
 *
 * Body: { agentId: string }
 *
 * On success: increments charterCurrentTurn and returns { granted: true, ... }.
 * On rejection: returns 409 with reason (wrong agent, max turns, not active).
 *
 * Auth: x-internal-secret header.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;

  let body: { agentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentId } = body;
  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  try {
    // Use an interactive transaction for serializable read-check-update
    const result = await prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUnique({
        where: { id: channelId },
        select: {
          charterStatus: true,
          swarmMode: true,
          charterCurrentTurn: true,
          charterMaxTurns: true,
          charterAgentOrder: true,
        },
      });

      if (!channel) {
        return { granted: false, reason: "Channel not found", status: 404 };
      }

      if (channel.charterStatus !== "ACTIVE") {
        return {
          granted: false,
          reason: `Charter is not active (status: ${channel.charterStatus})`,
          status: 409,
        };
      }

      // Check max turns
      if (
        channel.charterMaxTurns > 0 &&
        channel.charterCurrentTurn >= channel.charterMaxTurns
      ) {
        return {
          granted: false,
          reason: "Charter complete: maximum turns reached",
          status: 409,
        };
      }

      // Check turn order for ordered modes
      const orderedModes = ["ROUND_ROBIN", "CODE_REVIEW_SPRINT"];
      const agentOrder = channel.charterAgentOrder ?? [];
      if (orderedModes.includes(channel.swarmMode) && agentOrder.length > 0) {
        const expectedIndex = channel.charterCurrentTurn % agentOrder.length;
        const expectedAgent = agentOrder[expectedIndex];
        if (expectedAgent !== agentId) {
          return {
            granted: false,
            reason: `Not your turn: waiting for agent ${expectedAgent} (turn ${channel.charterCurrentTurn + 1})`,
            status: 409,
          };
        }
      }

      // Claim the turn by incrementing atomically within the transaction
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: { charterCurrentTurn: { increment: 1 } },
        select: {
          charterCurrentTurn: true,
          charterMaxTurns: true,
        },
      });

      let completed = false;
      if (
        updated.charterMaxTurns > 0 &&
        updated.charterCurrentTurn >= updated.charterMaxTurns
      ) {
        await tx.channel.update({
          where: { id: channelId },
          data: { charterStatus: "COMPLETED" },
        });
        completed = true;
      }

      return {
        granted: true,
        currentTurn: updated.charterCurrentTurn,
        maxTurns: updated.charterMaxTurns,
        completed,
        status: 200,
      };
    });

    if (!result.granted) {
      return NextResponse.json(
        { granted: false, reason: result.reason },
        { status: result.status },
      );
    }

    return NextResponse.json({
      granted: true,
      currentTurn: result.currentTurn,
      maxTurns: result.maxTurns,
      completed: result.completed,
    });
  } catch (error) {
    console.error("Failed to claim charter turn:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
