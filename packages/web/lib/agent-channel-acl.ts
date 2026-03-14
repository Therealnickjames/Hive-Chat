import { prisma } from "@/lib/db";

interface AgentScope {
  agentId: string;
  serverId: string;
}

type SingleChannelAccessResult =
  | { ok: true; channelId: string }
  | { ok: false; status: 403 | 404; error: string };

type MultiChannelAccessResult =
  | { ok: true; channelIds: string[] }
  | { ok: false; status: 403 | 404; error: string };

export async function verifyAgentChannelAccess(
  agent: AgentScope,
  channelId: string,
): Promise<SingleChannelAccessResult> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true },
  });

  // Hide channel existence outside the caller's server boundary.
  if (!channel || channel.serverId !== agent.serverId) {
    return { ok: false, status: 404, error: "Channel not found" };
  }

  const channelAgent = await prisma.channelAgent.findFirst({
    where: { channelId, agentId: agent.agentId },
    select: { id: true },
  });

  if (!channelAgent) {
    return {
      ok: false,
      status: 403,
      error: "Agent is not assigned to this channel",
    };
  }

  return { ok: true, channelId };
}

export async function verifyAgentChannelsAccess(
  agent: AgentScope,
  channelIds: string[],
): Promise<MultiChannelAccessResult> {
  const uniqueChannelIds = [...new Set(channelIds)];

  if (uniqueChannelIds.length === 0) {
    return { ok: true, channelIds: uniqueChannelIds };
  }

  const channels = await prisma.channel.findMany({
    where: { id: { in: uniqueChannelIds } },
    select: { id: true, serverId: true },
  });

  if (
    channels.length !== uniqueChannelIds.length ||
    channels.some((channel) => channel.serverId !== agent.serverId)
  ) {
    return { ok: false, status: 404, error: "One or more channels were not found" };
  }

  const assignments = await prisma.channelAgent.findMany({
    where: {
      agentId: agent.agentId,
      channelId: { in: uniqueChannelIds },
    },
    select: { channelId: true },
  });

  if (assignments.length !== uniqueChannelIds.length) {
    return {
      ok: false,
      status: 403,
      error: "Agent is not assigned to one or more requested channels",
    };
  }

  return { ok: true, channelIds: uniqueChannelIds };
}
