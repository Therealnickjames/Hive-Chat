import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/channels/{channelId}/agents
 *
 * Returns ALL agents assigned to a channel with API keys DECRYPTED.
 * Falls back to the single defaultAgent if no ChannelAgent entries exist (backward compat).
 * Used by the Gateway to trigger multiple agents on message send (TASK-0012).
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    // 1. Try ChannelAgent join table first (multi-agent)
    const channelAgents = await prisma.channelAgent.findMany({
      where: { channelId },
      include: { agent: true },
      orderBy: { createdAt: "asc" },
    });

    if (channelAgents.length > 0) {
      // Load agent registrations for connectionMethod lookup (DEC-0043)
      const activeAgentIds = channelAgents
        .filter((ca: (typeof channelAgents)[number]) => ca.agent.isActive)
        .map((ca: (typeof channelAgents)[number]) => ca.agent.id);
      const agentRegs = await prisma.agentRegistration.findMany({
        where: { agentId: { in: activeAgentIds } },
        select: { agentId: true, connectionMethod: true },
      });
      const regMap = new Map(
        agentRegs.map((r: (typeof agentRegs)[number]) => [
          r.agentId,
          r.connectionMethod,
        ]),
      );

      // Return all active agents with decrypted keys
      const agents = channelAgents
        .filter((ca: (typeof channelAgents)[number]) => ca.agent.isActive)
        .map((ca: (typeof channelAgents)[number]) => {
          let apiKey = "";
          try {
            apiKey = decrypt(ca.agent.apiKeyEncrypted);
          } catch {
            console.error(
              `[Internal] Failed to decrypt API key for agent ${ca.agent.id}`,
            );
          }

          return {
            id: ca.agent.id,
            name: ca.agent.name,
            avatarUrl: ca.agent.avatarUrl,
            llmProvider: ca.agent.llmProvider,
            llmModel: ca.agent.llmModel,
            apiEndpoint: ca.agent.apiEndpoint,
            apiKey,
            systemPrompt: ca.agent.systemPrompt,
            temperature: ca.agent.temperature,
            maxTokens: ca.agent.maxTokens,
            triggerMode: ca.agent.triggerMode,
            thinkingSteps: ca.agent.thinkingSteps
              ? JSON.parse(ca.agent.thinkingSteps)
              : [], // TASK-0011
            connectionMethod: regMap.get(ca.agent.id) || "WEBSOCKET", // DEC-0043
          };
        });

      return NextResponse.json({ agents });
    }

    // 2. Fallback: check defaultAgent (backward compat for channels not yet migrated)
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { defaultAgent: true },
    });

    if (!channel || !channel.defaultAgent || !channel.defaultAgent.isActive) {
      // BUG-008: Log when no agents found — helps diagnose BYOK trigger failures
      console.info(
        `[Internal] No active agents for channel ${channelId} (no ChannelAgent records, no active defaultAgent)`,
      );
      return NextResponse.json({ agents: [] });
    }

    const agent = channel.defaultAgent;
    let apiKey = "";
    try {
      apiKey = decrypt(agent.apiKeyEncrypted);
    } catch {
      console.error(
        `[Internal] Failed to decrypt API key for agent ${agent.id}`,
      );
    }

    // Check if this agent has an agent registration for connectionMethod (DEC-0043)
    const agentReg = await prisma.agentRegistration.findUnique({
      where: { agentId: agent.id },
      select: { connectionMethod: true },
    });

    return NextResponse.json({
      agents: [
        {
          id: agent.id,
          name: agent.name,
          avatarUrl: agent.avatarUrl,
          llmProvider: agent.llmProvider,
          llmModel: agent.llmModel,
          apiEndpoint: agent.apiEndpoint,
          apiKey,
          systemPrompt: agent.systemPrompt,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          triggerMode: agent.triggerMode,
          thinkingSteps: agent.thinkingSteps
            ? JSON.parse(agent.thinkingSteps)
            : [], // TASK-0011
          connectionMethod: agentReg?.connectionMethod || "WEBSOCKET", // DEC-0043
        },
      ],
    });
  } catch (error) {
    console.error("[Internal] Failed to get channel agents:", error);
    return NextResponse.json(
      { error: "Failed to get channel agents" },
      { status: 500 },
    );
  }
}
