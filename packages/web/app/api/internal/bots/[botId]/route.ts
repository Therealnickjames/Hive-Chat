import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/bots/{botId}
 *
 * Returns full bot config with DECRYPTED API key.
 * Used by the Go Streaming Proxy to configure LLM API calls.
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ botId: string }> }
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botId } = await params;

  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
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
    console.error("[Internal] Failed to get bot:", error);
    return NextResponse.json(
      { error: "Failed to get bot" },
      { status: 500 }
    );
  }
}
