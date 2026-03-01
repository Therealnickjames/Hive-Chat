import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/channels/{channelId}/bot
 *
 * Returns the default bot config for a channel with the API key DECRYPTED.
 * Used by the Gateway to check bot triggers and build stream requests.
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        defaultBot: true,
      },
    });

    if (!channel || !channel.defaultBot) {
      return NextResponse.json({ error: "No default bot" }, { status: 404 });
    }

    const bot = channel.defaultBot;

    // Only return active bots
    if (!bot.isActive) {
      return NextResponse.json({ error: "Bot is inactive" }, { status: 404 });
    }

    // Decrypt API key for internal use
    let apiKey = "";
    try {
      apiKey = decrypt(bot.apiKeyEncrypted);
    } catch {
      console.error(`[Internal] Failed to decrypt API key for bot ${bot.id}`);
      return NextResponse.json(
        { error: "Failed to decrypt bot API key" },
        { status: 500 }
      );
    }

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("[Internal] Failed to get channel bot:", error);
    return NextResponse.json(
      { error: "Failed to get channel bot" },
      { status: 500 }
    );
  }
}
