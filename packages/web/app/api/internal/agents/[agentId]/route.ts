import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { validateInternalSecret } from "@/lib/internal-auth";

/**
 * GET /api/internal/agents/{agentId}
 *
 * Returns full agent config with DECRYPTED API key.
 * Used by the Go Streaming Proxy to configure LLM API calls.
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { agentId } = await params;

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Decrypt API key for internal use
    let apiKey = "";
    try {
      apiKey = decrypt(agent.apiKeyEncrypted);
    } catch {
      console.error(
        `[Internal] Failed to decrypt API key for agent ${agent.id}`,
      );
      return NextResponse.json(
        { error: "Failed to decrypt agent API key" },
        { status: 500 },
      );
    }

    return NextResponse.json({
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
      thinkingSteps: agent.thinkingSteps ? JSON.parse(agent.thinkingSteps) : [], // TASK-0011
      enabledTools: agent.enabledTools ? JSON.parse(agent.enabledTools) : [], // TASK-0018
    });
  } catch (error) {
    console.error("[Internal] Failed to get agent:", error);
    return NextResponse.json({ error: "Failed to get agent" }, { status: 500 });
  }
}
