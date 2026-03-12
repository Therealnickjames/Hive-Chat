import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";
import { generateId } from "@/lib/ulid";

/**
 * POST /api/servers/{serverId}/agents/import
 * Import an agent from a config template JSON.
 * Requires MANAGE_AGENTS permission.
 * Body: { template: {...}, apiKey?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_AGENTS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Agents" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const template = body.template as Record<string, unknown> | undefined;
  if (!template || typeof template !== "object") {
    return NextResponse.json(
      { error: "Missing 'template' object in body" },
      { status: 400 },
    );
  }

  // Validate required fields
  const name = typeof template.name === "string" ? template.name.trim() : null;
  if (!name) {
    return NextResponse.json(
      { error: "Template must include a 'name'" },
      { status: 400 },
    );
  }

  const llmProvider =
    typeof template.llmProvider === "string" ? template.llmProvider : "openai";
  const llmModel =
    typeof template.llmModel === "string" ? template.llmModel : "gpt-4o";
  const apiEndpoint =
    typeof template.apiEndpoint === "string"
      ? template.apiEndpoint
      : "https://api.openai.com";
  const systemPrompt =
    typeof template.systemPrompt === "string"
      ? template.systemPrompt
      : "You are a helpful assistant.";
  const temperature =
    typeof template.temperature === "number" ? template.temperature : 0.7;
  const maxTokens =
    typeof template.maxTokens === "number" ? template.maxTokens : 4096;
  const triggerMode =
    typeof template.triggerMode === "string" &&
    ["ALWAYS", "MENTION", "KEYWORD"].includes(template.triggerMode)
      ? template.triggerMode
      : "ALWAYS";

  // Optional fields
  const thinkingSteps = template.thinkingSteps ?? null;
  const enabledTools = template.enabledTools ?? null;

  // Build agent data — match existing creation pattern (explicit id + serverId)
  const agentId = generateId();
  const agentData: Record<string, unknown> = {
    id: agentId,
    name,
    serverId,
    llmProvider,
    llmModel,
    apiEndpoint,
    systemPrompt,
    temperature,
    maxTokens,
    triggerMode,
    thinkingSteps,
    enabledTools,
    isActive: true,
  };

  // Optional API key from the importing user
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : null;
  if (apiKey) {
    agentData.apiKeyEncrypted = encrypt(apiKey);
  }

  // Create agent + auto-assign to all channels (same pattern as agent creation route)
  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });

  const agent = await prisma.agent.create({
    data: agentData as Parameters<typeof prisma.agent.create>[0]["data"],
    select: {
      id: true,
      name: true,
      llmProvider: true,
      llmModel: true,
      apiEndpoint: true,
      systemPrompt: true,
      temperature: true,
      maxTokens: true,
      isActive: true,
      triggerMode: true,
      thinkingSteps: true,
      createdAt: true,
    },
  });

  // Assign to all channels
  if (channels.length > 0) {
    await prisma.channelAgent.createMany({
      data: channels.map((ch) => ({
        id: generateId(),
        channelId: ch.id,
        agentId: agent.id,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json(agent, { status: 201 });
}
