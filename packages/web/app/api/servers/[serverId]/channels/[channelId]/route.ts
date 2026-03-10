import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canMutateServerScopedResource,
  serializeSequence,
} from "@/lib/api-safety";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";
import { ulid } from "ulid";

/**
 * PATCH /api/servers/{serverId}/channels/{channelId}
 *
 * Update channel settings (assign agents, topic, etc.).
 * Supports both `defaultAgentId` (legacy single agent) and `agentIds` (multi-agent, TASK-0012).
 * Requires MANAGE_CHANNELS permission.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, channelId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_CHANNELS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Channels" },
      { status: 403 },
    );
  }

  const existingChannel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });
  if (
    !existingChannel ||
    !canMutateServerScopedResource(serverId, existingChannel.serverId)
  ) {
    return NextResponse.json(
      { error: "Channel not found in this server" },
      { status: 404 },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsedBody = await request.json();
    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Valid swarm modes for TASK-0020
  const VALID_SWARM_MODES = [
    "HUMAN_IN_THE_LOOP",
    "LEAD_AGENT",
    "ROUND_ROBIN",
    "STRUCTURED_DEBATE",
    "CODE_REVIEW_SPRINT",
    "FREEFORM",
    "CUSTOM",
  ];

  const updateData: Record<string, unknown> = {};

  if ("defaultAgentId" in body) {
    if (body.defaultAgentId === null) {
      updateData.defaultAgentId = null;
    } else if (
      typeof body.defaultAgentId !== "string" ||
      body.defaultAgentId.length === 0
    ) {
      return NextResponse.json(
        { error: "defaultAgentId must be a string or null" },
        { status: 400 },
      );
    } else {
      const agent = await prisma.agent.findUnique({
        where: { id: body.defaultAgentId },
      });
      if (!agent || agent.serverId !== serverId) {
        return NextResponse.json(
          { error: "Agent not found in this server" },
          { status: 400 },
        );
      }
      updateData.defaultAgentId = body.defaultAgentId;
    }
  }

  if ("topic" in body) {
    if (body.topic === null || body.topic === "") {
      updateData.topic = null;
    } else if (typeof body.topic === "string") {
      if (body.topic.length > 300) {
        return NextResponse.json(
          { error: "Topic must be 300 characters or fewer" },
          { status: 400 },
        );
      }
      updateData.topic = body.topic;
    } else {
      return NextResponse.json(
        { error: "topic must be a string or null" },
        { status: 400 },
      );
    }
  }

  // Handle swarm mode fields (TASK-0020)
  if ("swarmMode" in body) {
    if (
      typeof body.swarmMode !== "string" ||
      !VALID_SWARM_MODES.includes(body.swarmMode)
    ) {
      return NextResponse.json(
        { error: `swarmMode must be one of: ${VALID_SWARM_MODES.join(", ")}` },
        { status: 400 },
      );
    }
    updateData.swarmMode = body.swarmMode;
  }

  if ("charterGoal" in body) {
    if (body.charterGoal !== null && typeof body.charterGoal !== "string") {
      return NextResponse.json(
        { error: "charterGoal must be a string or null" },
        { status: 400 },
      );
    }
    updateData.charterGoal = body.charterGoal || null;
  }

  if ("charterRules" in body) {
    if (body.charterRules !== null && typeof body.charterRules !== "string") {
      return NextResponse.json(
        { error: "charterRules must be a string or null" },
        { status: 400 },
      );
    }
    updateData.charterRules = body.charterRules || null;
  }

  if ("charterAgentOrder" in body) {
    if (
      body.charterAgentOrder !== null &&
      !Array.isArray(body.charterAgentOrder)
    ) {
      return NextResponse.json(
        { error: "charterAgentOrder must be an array or null" },
        { status: 400 },
      );
    }
    updateData.charterAgentOrder = body.charterAgentOrder
      ? JSON.stringify(body.charterAgentOrder)
      : null;
  }

  if ("charterMaxTurns" in body) {
    if (typeof body.charterMaxTurns !== "number" || body.charterMaxTurns < 0) {
      return NextResponse.json(
        { error: "charterMaxTurns must be a non-negative integer" },
        { status: 400 },
      );
    }
    updateData.charterMaxTurns = Math.floor(body.charterMaxTurns);
  }

  // Handle agentIds array (multi-agent assignment — TASK-0012)
  if ("agentIds" in body) {
    const agentIds = body.agentIds;
    if (!Array.isArray(agentIds)) {
      return NextResponse.json(
        { error: "agentIds must be an array of strings" },
        { status: 400 },
      );
    }

    // Validate all agent IDs exist in this server
    if (agentIds.length > 0) {
      const validAgents = await prisma.agent.findMany({
        where: { id: { in: agentIds as string[] }, serverId },
        select: { id: true },
      });
      const validIds = new Set(validAgents.map((a) => a.id));
      const invalid = (agentIds as string[]).filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Agents not found in this server: ${invalid.join(", ")}` },
          { status: 400 },
        );
      }
    }

    // Transaction: delete old ChannelAgent entries → create new ones → update defaultAgentId
    await prisma.$transaction([
      prisma.channelAgent.deleteMany({ where: { channelId } }),
      ...(agentIds as string[]).map((agentId: string) =>
        prisma.channelAgent.create({
          data: { id: ulid(), channelId, agentId },
        }),
      ),
      // Set first agent as defaultAgentId for backward compat
      prisma.channel.update({
        where: { id: channelId },
        data: {
          defaultAgentId: agentIds.length > 0 ? (agentIds[0] as string) : null,
        },
      }),
    ]);
  }

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data: updateData,
    include: {
      channelAgents: { select: { agentId: true } },
    },
  });

  // Parse charterAgentOrder JSON string → array for client
  let parsedAgentOrder: string[] | null = null;
  if (channel.charterAgentOrder) {
    try {
      parsedAgentOrder = JSON.parse(channel.charterAgentOrder);
    } catch {
      parsedAgentOrder = null;
    }
  }

  return NextResponse.json({
    ...channel,
    lastSequence: serializeSequence(channel.lastSequence),
    agentIds: channel.channelAgents.map((ca) => ca.agentId),
    charterAgentOrder: parsedAgentOrder,
  });
}

/**
 * DELETE /api/servers/{serverId}/channels/{channelId}
 * Requires MANAGE_CHANNELS permission. Cannot delete the last channel.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, channelId } = await params;

  const permCheck = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_CHANNELS,
  );
  if (!permCheck.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Channels" },
      { status: 403 },
    );
  }

  try {
    // Cannot delete last channel
    const channelCount = await prisma.channel.count({
      where: { serverId },
    });
    if (channelCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last channel in a server" },
        { status: 400 },
      );
    }

    // Verify channel belongs to this server
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, serverId },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    await prisma.channel.delete({ where: { id: channelId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete channel:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
