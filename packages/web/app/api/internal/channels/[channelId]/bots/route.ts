import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/channels/{channelId}/bots
 *
 * Returns ALL bots assigned to a channel with API keys DECRYPTED.
 * Falls back to the single defaultBot if no ChannelBot entries exist (backward compat).
 * Used by the Gateway to trigger multiple bots on message send (TASK-0012).
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
    // 1. Try ChannelBot join table first (multi-bot)
    const channelBots = await prisma.channelBot.findMany({
      where: { channelId },
      include: { bot: true },
      orderBy: { createdAt: "asc" },
    });

    if (channelBots.length > 0) {
      // Load agent registrations for connectionMethod lookup (DEC-0043)
      const activeBotIds = channelBots
        .filter((cb: (typeof channelBots)[number]) => cb.bot.isActive)
        .map((cb: (typeof channelBots)[number]) => cb.bot.id);
      const agentRegs = await prisma.agentRegistration.findMany({
        where: { botId: { in: activeBotIds } },
        select: { botId: true, connectionMethod: true },
      });
      const regMap = new Map(
        agentRegs.map((r: (typeof agentRegs)[number]) => [
          r.botId,
          r.connectionMethod,
        ]),
      );

      // Return all active bots with decrypted keys
      const bots = channelBots
        .filter((cb: (typeof channelBots)[number]) => cb.bot.isActive)
        .map((cb: (typeof channelBots)[number]) => {
          let apiKey = "";
          try {
            apiKey = decrypt(cb.bot.apiKeyEncrypted);
          } catch {
            console.error(
              `[Internal] Failed to decrypt API key for bot ${cb.bot.id}`,
            );
          }

          return {
            id: cb.bot.id,
            name: cb.bot.name,
            avatarUrl: cb.bot.avatarUrl,
            llmProvider: cb.bot.llmProvider,
            llmModel: cb.bot.llmModel,
            apiEndpoint: cb.bot.apiEndpoint,
            apiKey,
            systemPrompt: cb.bot.systemPrompt,
            temperature: cb.bot.temperature,
            maxTokens: cb.bot.maxTokens,
            triggerMode: cb.bot.triggerMode,
            thinkingSteps: cb.bot.thinkingSteps
              ? JSON.parse(cb.bot.thinkingSteps)
              : [], // TASK-0011
            connectionMethod: regMap.get(cb.bot.id) || "WEBSOCKET", // DEC-0043
          };
        });

      return NextResponse.json({ bots });
    }

    // 2. Fallback: check defaultBot (backward compat for channels not yet migrated)
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { defaultBot: true },
    });

    if (!channel || !channel.defaultBot || !channel.defaultBot.isActive) {
      return NextResponse.json({ bots: [] });
    }

    const bot = channel.defaultBot;
    let apiKey = "";
    try {
      apiKey = decrypt(bot.apiKeyEncrypted);
    } catch {
      console.error(`[Internal] Failed to decrypt API key for bot ${bot.id}`);
    }

    // Check if this bot has an agent registration for connectionMethod (DEC-0043)
    const agentReg = await prisma.agentRegistration.findUnique({
      where: { botId: bot.id },
      select: { connectionMethod: true },
    });

    return NextResponse.json({
      bots: [
        {
          id: bot.id,
          name: bot.name,
          avatarUrl: bot.avatarUrl,
          llmProvider: bot.llmProvider,
          llmModel: bot.llmModel,
          apiEndpoint: bot.apiEndpoint,
          apiKey,
          systemPrompt: bot.systemPrompt,
          temperature: bot.temperature,
          maxTokens: bot.maxTokens,
          triggerMode: bot.triggerMode,
          thinkingSteps: bot.thinkingSteps ? JSON.parse(bot.thinkingSteps) : [], // TASK-0011
          connectionMethod: agentReg?.connectionMethod || "WEBSOCKET", // DEC-0043
        },
      ],
    });
  } catch (error) {
    console.error("[Internal] Failed to get channel bots:", error);
    return NextResponse.json(
      { error: "Failed to get channel bots" },
      { status: 500 },
    );
  }
}
