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
 * GET /api/servers/{serverId}/bots — List all bots for a server
 * POST /api/servers/{serverId}/bots — Create a new bot (MANAGE_BOTS)
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

  const bots = await prisma.bot.findMany({
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
  const result = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    avatarUrl: bot.avatarUrl,
    llmProvider: bot.llmProvider,
    llmModel: bot.llmModel,
    apiEndpoint: bot.apiEndpoint,
    systemPrompt: bot.systemPrompt,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
    isActive: bot.isActive,
    triggerMode: bot.triggerMode,
    thinkingSteps: bot.thinkingSteps,
    connectionMethod: bot.connectionMethod || null, // null = BYOK
    capabilities: bot.agentRegistration?.capabilities || null,
    createdAt: bot.createdAt,
  }));

  return NextResponse.json({ bots: result });
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
    Permissions.MANAGE_BOTS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Bots" },
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

  // ─── Non-BYOK creation (DEC-0047) ───
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

  // ─── BYOK creation (existing flow) ───
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

  const bot = await prisma.bot.create({
    data: {
      id: ulid(),
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

  return NextResponse.json(
    {
      id: bot.id,
      name: bot.name,
      llmProvider: bot.llmProvider,
      llmModel: bot.llmModel,
      apiEndpoint: bot.apiEndpoint,
      systemPrompt: bot.systemPrompt,
      temperature: bot.temperature,
      maxTokens: bot.maxTokens,
      isActive: bot.isActive,
      triggerMode: bot.triggerMode,
      thinkingSteps: bot.thinkingSteps ? JSON.parse(bot.thinkingSteps) : null,
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
      result.bot.id,
      result.connectionMethod,
      {
        webhookUrl: opts.webhookUrl,
        webhookSecret: result.webhookSecret,
      },
    );

    return NextResponse.json(
      {
        id: result.bot.id,
        name: result.bot.name,
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
