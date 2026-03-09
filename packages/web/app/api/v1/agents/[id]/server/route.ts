import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAgentRequest } from "@/lib/agent-auth";

/**
 * GET /api/v1/agents/{id}/server — Server info + channels
 *
 * Returns the server the agent belongs to, including all channels.
 * Lets agents discover their environment after registration.
 *
 * Auth: Authorization: Bearer sk-tvk-...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  const agent = await authenticateAgentRequest(request);
  if (!agent || agent.botId !== agentId) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  const server = await prisma.server.findUnique({
    where: { id: agent.serverId },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      channels: {
        select: {
          id: true,
          name: true,
          topic: true,
          type: true,
          position: true,
        },
        orderBy: { position: "asc" },
      },
      bots: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          triggerMode: true,
          connectionMethod: true,
        },
      },
    },
  });

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  return NextResponse.json({
    server: {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
    },
    channels: server.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      topic: ch.topic,
      type: ch.type,
      position: ch.position,
      websocketTopic: `room:${ch.id}`,
    })),
    agents: server.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      avatarUrl: bot.avatarUrl,
      triggerMode: bot.triggerMode,
      connectionMethod: bot.connectionMethod,
    })),
  });
}
