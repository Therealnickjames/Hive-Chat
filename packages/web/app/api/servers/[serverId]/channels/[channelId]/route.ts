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
 * Update channel settings (assign bots, topic, etc.).
 * Supports both `defaultBotId` (legacy single bot) and `botIds` (multi-bot, TASK-0012).
 * Requires MANAGE_CHANNELS permission.
 */
export async function PATCH(
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
      { status: 404 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsedBody = await request.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Valid swarm modes for TASK-0020
  const VALID_SWARM_MODES = [
    "HUMAN_IN_THE_LOOP", "LEAD_AGENT", "ROUND_ROBIN",
    "STRUCTURED_DEBATE", "CODE_REVIEW_SPRINT", "FREEFORM", "CUSTOM",
  ];

  const updateData: Record<string, unknown> = {};

  if ("defaultBotId" in body) {
    if (body.defaultBotId === null) {
      updateData.defaultBotId = null;
    } else if (
      typeof body.defaultBotId !== "string" ||
      body.defaultBotId.length === 0
    ) {
      return NextResponse.json(
        { error: "defaultBotId must be a string or null" },
        { status: 400 }
      );
    } else {
      const bot = await prisma.bot.findUnique({
        where: { id: body.defaultBotId },
      });
      if (!bot || bot.serverId !== serverId) {
        return NextResponse.json(
          { error: "Bot not found in this server" },
          { status: 400 }
        );
      }
      updateData.defaultBotId = body.defaultBotId;
    }
  }

  if ("topic" in body) {
    if (body.topic === null || body.topic === "") {
      updateData.topic = null;
    } else if (typeof body.topic === "string") {
      if (body.topic.length > 300) {
        return NextResponse.json(
          { error: "Topic must be 300 characters or fewer" },
          { status: 400 }
        );
      }
      updateData.topic = body.topic;
    } else {
      return NextResponse.json(
        { error: "topic must be a string or null" },
        { status: 400 }
      );
    }
  }

  // Handle swarm mode fields (TASK-0020)
  if ("swarmMode" in body) {
    if (typeof body.swarmMode !== "string" || !VALID_SWARM_MODES.includes(body.swarmMode)) {
      return NextResponse.json(
        { error: `swarmMode must be one of: ${VALID_SWARM_MODES.join(", ")}` },
        { status: 400 }
      );
    }
    updateData.swarmMode = body.swarmMode;
  }

  if ("charterGoal" in body) {
    if (body.charterGoal !== null && typeof body.charterGoal !== "string") {
      return NextResponse.json({ error: "charterGoal must be a string or null" }, { status: 400 });
    }
    updateData.charterGoal = body.charterGoal || null;
  }

  if ("charterRules" in body) {
    if (body.charterRules !== null && typeof body.charterRules !== "string") {
      return NextResponse.json({ error: "charterRules must be a string or null" }, { status: 400 });
    }
    updateData.charterRules = body.charterRules || null;
  }

  if ("charterAgentOrder" in body) {
    if (body.charterAgentOrder !== null && !Array.isArray(body.charterAgentOrder)) {
      return NextResponse.json({ error: "charterAgentOrder must be an array or null" }, { status: 400 });
    }
    updateData.charterAgentOrder = body.charterAgentOrder
      ? JSON.stringify(body.charterAgentOrder)
      : null;
  }

  if ("charterMaxTurns" in body) {
    if (typeof body.charterMaxTurns !== "number" || body.charterMaxTurns < 0) {
      return NextResponse.json({ error: "charterMaxTurns must be a non-negative integer" }, { status: 400 });
    }
    updateData.charterMaxTurns = Math.floor(body.charterMaxTurns);
  }

  // Handle botIds array (multi-bot assignment — TASK-0012)
  if ("botIds" in body) {
    const botIds = body.botIds;
    if (!Array.isArray(botIds)) {
      return NextResponse.json(
        { error: "botIds must be an array of strings" },
        { status: 400 }
      );
    }

    // Validate all bot IDs exist in this server
    if (botIds.length > 0) {
      const validBots = await prisma.bot.findMany({
        where: { id: { in: botIds as string[] }, serverId },
        select: { id: true },
      });
      const validIds = new Set(validBots.map((b) => b.id));
      const invalid = (botIds as string[]).filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Bots not found in this server: ${invalid.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Transaction: delete old ChannelBot entries → create new ones → update defaultBotId
    await prisma.$transaction([
      prisma.channelBot.deleteMany({ where: { channelId } }),
      ...(botIds as string[]).map((botId: string) =>
        prisma.channelBot.create({
          data: { id: ulid(), channelId, botId },
        })
      ),
      // Set first bot as defaultBotId for backward compat
      prisma.channel.update({
        where: { id: channelId },
        data: { defaultBotId: botIds.length > 0 ? (botIds[0] as string) : null },
      }),
    ]);
  }

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data: updateData,
    include: {
      channelBots: { select: { botId: true } },
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
    botIds: channel.channelBots.map((cb) => cb.botId),
    charterAgentOrder: parsedAgentOrder,
  });
}
