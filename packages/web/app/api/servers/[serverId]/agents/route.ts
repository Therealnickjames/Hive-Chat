import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { ulid } from "ulid";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";
import {
  createAgent,
  buildConnectionInfo,
  VALID_CONNECTION_METHODS,
  type ConnectionMethodValue,
} from "@/lib/agent-factory";

/**
 * GET /api/servers/{serverId}/agents — List all agents for a server
 * POST /api/servers/{serverId}/agents — Create a new agent (MANAGE_AGENTS)
 *
 * Extended (DEC-0047): GET includes connectionMethod.
 * POST supports non-BYOK creation when `connectionMethod` is provided.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  // Verify membership
  const member = await prisma.member.findUnique({
    where: { userId_serverId: { userId: session.user.id, serverId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const agents = await prisma.agent.findMany({
    where: { serverId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      llmProvider: true,
      llmModel: true,
      apiEndpoint: true,
      systemPrompt: true,
      temperature: true,
      maxTokens: true,
      isActive: true,
      triggerMode: true,
      thinkingSteps: true,
      connectionMethod: true, // DEC-0047
      createdAt: true,
      // Never expose apiKeyEncrypted
      agentRegistration: {
        select: {
          connectionMethod: true,
          capabilities: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Transform: flatten agentRegistration fields for the client
  const result = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    avatarUrl: agent.avatarUrl,
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    apiEndpoint: agent.apiEndpoint,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    isActive: agent.isActive,
    triggerMode: agent.triggerMode,
    thinkingSteps: agent.thinkingSteps,
    connectionMethod: agent.connectionMethod || null, // null = BYOK
    capabilities: agent.agentRegistration?.capabilities || null,
    createdAt: agent.createdAt,
  }));

  return NextResponse.json({ agents: result });
}

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

  const body = await request.json();
  const {
    name,
    connectionMethod,
    llmProvider,
    llmModel,
    apiEndpoint,
    apiKey,
    systemPrompt,
    temperature = 0.7,
    maxTokens = 4096,
    triggerMode = "MENTION",
    thinkingSteps,
    // Method-specific fields
    webhookUrl,
    capabilities,
  } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // --- Non-BYOK creation (DEC-0047) ---
  if (connectionMethod && VALID_CONNECTION_METHODS.includes(connectionMethod)) {
    return createNonBYOKAgent(serverId, {
      name: name.trim(),
      connectionMethod: connectionMethod as ConnectionMethodValue,
      triggerMode,
      webhookUrl,
      capabilities,
      systemPrompt,
    });
  }

  // --- BYOK creation (existing flow) ---
  if (!llmProvider || !llmModel || !apiEndpoint || !apiKey || !systemPrompt) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: name, llmProvider, llmModel, apiEndpoint, apiKey, systemPrompt",
      },
      { status: 400 },
    );
  }

  // Encrypt the API key
  const apiKeyEncrypted = encrypt(apiKey);

  const agentId = ulid();
  const agent = await prisma.agent.create({
    data: {
      id: agentId,
      name,
      serverId,
      llmProvider,
      llmModel,
      apiEndpoint,
      apiKeyEncrypted,
      systemPrompt,
      temperature,
      maxTokens,
      isActive: true,
      triggerMode,
      thinkingSteps: thinkingSteps ? JSON.stringify(thinkingSteps) : undefined,
    },
  });

  // Auto-assign BYOK agent to all channels in the server so Gateway can trigger it
  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  if (channels.length > 0) {
    await prisma.channelAgent.createMany({
      data: channels.map((ch) => ({
        id: ulid(),
        channelId: ch.id,
        agentId: agent.id,
      })),
    });
  }

  return NextResponse.json(
    {
      id: agent.id,
      name: agent.name,
      llmProvider: agent.llmProvider,
      llmModel: agent.llmModel,
      apiEndpoint: agent.apiEndpoint,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      isActive: agent.isActive,
      triggerMode: agent.triggerMode,
      thinkingSteps: agent.thinkingSteps
        ? JSON.parse(agent.thinkingSteps)
        : null,
    },
    { status: 201 },
  );
}

/**
 * Create a non-BYOK agent (owner-initiated).
 * Delegates to shared createAgent factory, wraps result in NextResponse.
 */
async function createNonBYOKAgent(
  serverId: string,
  opts: {
    name: string;
    connectionMethod: ConnectionMethodValue;
    triggerMode?: string;
    webhookUrl?: string;
    capabilities?: string[];
    systemPrompt?: string;
  },
) {
  try {
    const result = await createAgent({
      ...opts,
      serverId,
    });

    const connectionInfo = buildConnectionInfo(
      result.agent.id,
      result.connectionMethod,
      {
        webhookUrl: opts.webhookUrl,
        webhookSecret: result.webhookSecret,
      },
    );

    return NextResponse.json(
      {
        id: result.agent.id,
        name: result.agent.name,
        connectionMethod: result.connectionMethod,
        apiKey: result.apiKey,
        ...connectionInfo,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Non-BYOK agent creation failed:", error);
    return NextResponse.json(
      { error: "Agent creation failed" },
      { status: 500 },
    );
  }
}
