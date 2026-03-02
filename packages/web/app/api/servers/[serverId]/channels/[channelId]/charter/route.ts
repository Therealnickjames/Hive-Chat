import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canMutateServerScopedResource } from "@/lib/api-safety";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

const VALID_ACTIONS = ["start", "pause", "resume", "end"] as const;
type CharterAction = (typeof VALID_ACTIONS)[number];

/**
 * POST /api/servers/{serverId}/channels/{channelId}/charter
 *
 * Control the charter session lifecycle (TASK-0020).
 * Body: { action: "start" | "pause" | "resume" | "end" }
 *
 * - start:  Sets charterStatus: ACTIVE, charterCurrentTurn: 0
 * - pause:  Sets charterStatus: PAUSED
 * - resume: Sets charterStatus: ACTIVE (keeps current turn)
 * - end:    Sets charterStatus: COMPLETED
 *
 * Requires MANAGE_CHANNELS permission.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, channelId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_CHANNELS
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Channels" },
      { status: 403 }
    );
  }

  // Verify channel belongs to this server
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, charterStatus: true, swarmMode: true },
  });
  if (
    !channel ||
    !canMutateServerScopedResource(serverId, channel.serverId)
  ) {
    return NextResponse.json(
      { error: "Channel not found in this server" },
      { status: 404 }
    );
  }

  let body: { action?: unknown };
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

  // State machine validation
  const currentStatus = channel.charterStatus;
  const transitions: Record<string, string[]> = {
    start: ["INACTIVE", "COMPLETED"], // Can start from inactive or re-start after completed
    pause: ["ACTIVE"],
    resume: ["PAUSED"],
    end: ["ACTIVE", "PAUSED"],
  };

  if (!transitions[action].includes(currentStatus)) {
    return NextResponse.json(
      {
        error: `Cannot ${action} charter: current status is ${currentStatus}`,
      },
      { status: 409 }
    );
  }

  // Build update data based on action
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
      charterGoal: true,
    },
  });

  return NextResponse.json({
    channelId: updated.id,
    swarmMode: updated.swarmMode,
    charterStatus: updated.charterStatus,
    charterCurrentTurn: updated.charterCurrentTurn,
    charterMaxTurns: updated.charterMaxTurns,
    charterGoal: updated.charterGoal,
  });
}
