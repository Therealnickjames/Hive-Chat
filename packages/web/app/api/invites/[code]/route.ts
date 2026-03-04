import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/invites/[code] — Get invite info (public, no auth required)
 * Returns server name, member count, and invite validity
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  const invite = await prisma.invite.findUnique({
    where: { code },
    include: {
      server: {
        include: {
          _count: { select: { members: true } },
        },
      },
      creator: { select: { displayName: true } },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  if (invite.maxUses && invite.uses >= invite.maxUses) {
    return NextResponse.json(
      { error: "Invite has reached max uses" },
      { status: 410 },
    );
  }

  return NextResponse.json({
    serverName: invite.server.name,
    serverIconUrl: invite.server.iconUrl,
    memberCount: invite.server._count.members,
    invitedBy: invite.creator.displayName,
  });
}
