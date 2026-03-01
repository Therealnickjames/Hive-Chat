import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canMutateServerScopedResource,
} from "@/lib/api-safety";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * PATCH /api/servers/{serverId}/channels/{channelId}
 *
 * Update channel settings (e.g., assign default bot).
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

  const updateData: {
    defaultBotId?: string | null;
    topic?: string | null;
  } = {};

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

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data: updateData,
    select: {
      id: true,
      name: true,
      topic: true,
      defaultBotId: true,
    },
  });

  return NextResponse.json(channel);
}
