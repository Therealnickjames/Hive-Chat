import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";

const VALID_ACTIONS = ["start", "pause", "resume", "end"] as const;
type CharterAction = (typeof VALID_ACTIONS)[number];

/**
 * POST /api/internal/channels/{channelId}/charter-control
 *
 * Internal API for charter session control, called by Gateway when
 * users send charter_control events via WebSocket. (TASK-0020)
 *
 * Body: { action: "start" | "pause" | "resume" | "end", serverId: string }
 * Auth: x-internal-secret header.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;

  let body: { action?: unknown; serverId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (
    typeof action !== "string" ||
    !VALID_ACTIONS.includes(action as CharterAction)
  ) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { charterStatus: true, swarmMode: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // State machine validation
    const currentStatus = channel.charterStatus;
    const transitions: Record<string, string[]> = {
      start: ["INACTIVE", "COMPLETED"],
      pause: ["ACTIVE"],
      resume: ["PAUSED"],
      end: ["ACTIVE", "PAUSED"],
    };

    if (!transitions[action].includes(currentStatus)) {
      return NextResponse.json(
        { error: `Cannot ${action} charter: current status is ${currentStatus}` },
        { status: 409 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    switch (action as CharterAction) {
      case "start":
        updateData.charterStatus = "ACTIVE";
        updateData.charterCurrentTurn = 0;
        break;
      case "pause":
        updateData.charterStatus = "PAUSED";
        break;
      case "resume":
        updateData.charterStatus = "ACTIVE";
        break;
      case "end":
        updateData.charterStatus = "COMPLETED";
        break;
    }

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: updateData,
      select: {
        id: true,
        swarmMode: true,
        charterStatus: true,
        charterCurrentTurn: true,
        charterMaxTurns: true,
      },
    });

    return NextResponse.json({
      channelId: updated.id,
      swarmMode: updated.swarmMode,
      charterStatus: updated.charterStatus,
      currentTurn: updated.charterCurrentTurn,
      maxTurns: updated.charterMaxTurns,
      status: updated.charterStatus,
    });
  } catch (error) {
    console.error("Charter control error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
