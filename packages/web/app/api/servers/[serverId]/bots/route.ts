import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { ulid } from "ulid";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * GET /api/servers/{serverId}/bots — List all bots for a server
 * POST /api/servers/{serverId}/bots — Create a new bot (MANAGE_BOTS)
 *
 * Extended (DEC-0047): GET includes connectionMethod + approvalStatus.
 * POST supports non-BYOK creation when `connectionMethod` is provided.
 */

const VALID_CONNECTION_METHODS = [
  "WEBSOCKET",
  "WEBHOOK",
  "INBOUND_WEBHOOK",
  "REST_POLL",
  "SSE",
  "OPENAI_COMPAT",
] as const;

type ConnectionMethodValue = (typeof VALID_CONNECTION_METHODS)[number];

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
          approvalStatus: true,
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
    approvalStatus: bot.agentRegistration?.approvalStatus || null, // null = BYOK (no registration)
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
 * Generates an API key, creates Bot + AgentRegistration, returns credentials.
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
  const botId = ulid();
  const registrationId = ulid();

  // Generate API key (same as self-registration flow)
  const randomBytes = crypto.randomBytes(32);
  const apiKey = `sk-tvk-${randomBytes.toString("base64url")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  // Generate webhook secret for WEBHOOK method
  const webhookSecret =
    opts.connectionMethod === "WEBHOOK"
      ? crypto.randomBytes(32).toString("hex")
      : undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bot = await tx.bot.create({
        data: {
          id: botId,
          name: opts.name,
          serverId,
          llmProvider: "custom",
          llmModel: "custom",
          apiEndpoint: "",
          apiKeyEncrypted: "",
          systemPrompt: opts.systemPrompt || "",
          temperature: 0.7,
          maxTokens: 4096,
          isActive: true,
          triggerMode: (opts.triggerMode || "MENTION") as
            | "ALWAYS"
            | "MENTION"
            | "KEYWORD",
          connectionMethod: opts.connectionMethod,
        },
      });

      const registration = await tx.agentRegistration.create({
        data: {
          id: registrationId,
          botId: bot.id,
          apiKeyHash,
          capabilities: Array.isArray(opts.capabilities)
            ? opts.capabilities
            : [],
          webhookUrl: opts.webhookUrl,
          connectionMethod: opts.connectionMethod,
          webhookSecret,
          approvalStatus: "APPROVED", // Owner-created = auto-approved
        },
      });

      return { bot, registration };
    });

    // Build response with method-specific URLs
    const gatewayUrl =
      process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:4001/socket";
    const webUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const response: Record<string, unknown> = {
      id: result.bot.id,
      name: result.bot.name,
      connectionMethod: opts.connectionMethod,
      apiKey, // Shown ONCE
      approvalStatus: "APPROVED",
    };

    // Method-specific connection info
    switch (opts.connectionMethod) {
      case "WEBSOCKET":
        response.websocketUrl = `${gatewayUrl}/websocket`;
        break;
      case "WEBHOOK":
        response.webhookUrl = opts.webhookUrl;
        response.webhookSecret = webhookSecret; // Shown ONCE
        break;
      case "REST_POLL":
        response.pollUrl = `${webUrl}/api/v1/agents/${result.bot.id}/messages`;
        break;
      case "SSE":
        response.eventsUrl = `${webUrl}/api/v1/agents/${result.bot.id}/events`;
        break;
      case "OPENAI_COMPAT":
        response.chatCompletionsUrl = `${webUrl}/api/v1/chat/completions`;
        response.modelsUrl = `${webUrl}/api/v1/models`;
        break;
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Non-BYOK agent creation failed:", error);
    return NextResponse.json(
      { error: "Agent creation failed" },
      { status: 500 },
    );
  }
}
