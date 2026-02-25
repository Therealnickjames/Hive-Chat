import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canMutateServerScopedResource } from "@/lib/api-safety";

/**
 * PATCH /api/servers/{serverId}/channels/{channelId}
 *
 * Update channel settings (e.g., assign default bot).
 * Requires server ownership.
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

  // Verify ownership
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
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

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  // Handle defaultBotId — can be a bot ID or null to unassign
  if ("defaultBotId" in body) {
    if (body.defaultBotId === null) {
      updateData.defaultBotId = null;
    } else {
      // Verify bot exists and belongs to this server
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

  // Handle topic update
  if ("topic" in body) {
    updateData.topic = body.topic || null;
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
