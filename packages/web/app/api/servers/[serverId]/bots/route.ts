import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { ulid } from "ulid";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * GET /api/servers/{serverId}/bots — List all bots for a server
 * POST /api/servers/{serverId}/bots — Create a new bot (MANAGE_BOTS)
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
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
      createdAt: true,
      // Never expose apiKeyEncrypted
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ bots });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_BOTS
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Bots" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const {
    name,
    llmProvider,
    llmModel,
    apiEndpoint,
    apiKey,
    systemPrompt,
    temperature = 0.7,
    maxTokens = 4096,
    triggerMode = "MENTION",
  } = body;

  if (!name || !llmProvider || !llmModel || !apiEndpoint || !apiKey || !systemPrompt) {
    return NextResponse.json(
      { error: "Missing required fields: name, llmProvider, llmModel, apiEndpoint, apiKey, systemPrompt" },
      { status: 400 }
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
    },
    { status: 201 }
  );
}
