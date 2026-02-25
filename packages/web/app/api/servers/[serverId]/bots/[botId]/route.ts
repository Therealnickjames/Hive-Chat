import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import {
  canMutateServerScopedResource,
} from "@/lib/api-safety";
import { createServerBotPatchHandler } from "@/lib/route-handlers";

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

export const PATCH = createServerBotPatchHandler({
  getServerSession,
  authOptions,
  prismaClient: prisma,
  encrypt,
});

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
