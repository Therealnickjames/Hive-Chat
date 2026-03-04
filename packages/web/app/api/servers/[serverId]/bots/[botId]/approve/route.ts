import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * POST /api/servers/{serverId}/bots/{botId}/approve — Approve a pending agent
 *
 * DEC-0047: Sets approvalStatus to APPROVED, activates the bot.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; botId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, botId } = await params;

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

  // Find the bot and its registration
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: { agentRegistration: true },
  });

  if (!bot || bot.serverId !== serverId) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  if (!bot.agentRegistration) {
    return NextResponse.json(
      { error: "Bot has no agent registration (BYOK bots do not require approval)" },
      { status: 400 }
    );
  }

  if (bot.agentRegistration.approvalStatus === "APPROVED") {
    return NextResponse.json(
      { error: "Agent is already approved" },
      { status: 400 }
    );
  }

  // Approve: update registration + activate bot
  await prisma.$transaction([
    prisma.agentRegistration.update({
      where: { id: bot.agentRegistration.id },
      data: {
        approvalStatus: "APPROVED",
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
      },
    }),
    prisma.bot.update({
      where: { id: botId },
      data: { isActive: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    approvalStatus: "APPROVED",
  });
}
