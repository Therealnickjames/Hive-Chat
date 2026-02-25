import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { canMutateServerScopedResource } from "@/lib/api-safety";

/**
 * GET /api/servers/{serverId}/bots/{botId} — Get bot details (no key)
 * PATCH /api/servers/{serverId}/bots/{botId} — Update bot (owner only)
 * DELETE /api/servers/{serverId}/bots/{botId} — Delete bot (owner only)
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; botId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, botId } = await params;

  // Verify membership
  const member = await prisma.member.findUnique({
    where: { userId_serverId: { userId: session.user.id, serverId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const bot = await prisma.bot.findUnique({
    where: { id: botId },
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
      serverId: true,
    },
  });

  if (!bot || !canMutateServerScopedResource(serverId, bot.serverId)) {
    return NextResponse.json({ error: "Bot not found in this server" }, { status: 404 });
  }

  const { serverId: _serverId, ...safeBot } = bot;
  return NextResponse.json(safeBot);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; botId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, botId } = await params;

  // Verify ownership
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
  }

  const existingBot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { serverId: true },
  });
  if (!existingBot || !canMutateServerScopedResource(serverId, existingBot.serverId)) {
    return NextResponse.json({ error: "Bot not found in this server" }, { status: 404 });
  }

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  // Only update provided fields
  const allowedFields = [
    "name", "llmProvider", "llmModel", "apiEndpoint",
    "systemPrompt", "temperature", "maxTokens", "isActive", "triggerMode",
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Re-encrypt API key if provided
  if (body.apiKey) {
    updateData.apiKeyEncrypted = encrypt(body.apiKey);
  }

  const bot = await prisma.bot.update({
    where: { id: botId },
    data: updateData,
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
    },
  });

  return NextResponse.json(bot);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; botId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, botId } = await params;

  // Verify ownership
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
  }

  const existingBot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { serverId: true },
  });
  if (!existingBot || !canMutateServerScopedResource(serverId, existingBot.serverId)) {
    return NextResponse.json({ error: "Bot not found in this server" }, { status: 404 });
  }

  await prisma.bot.delete({ where: { id: botId } });

  return NextResponse.json({ success: true });
}
