import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * POST /api/invites/[code]/accept — Join a server via invite
 * Auth: any logged-in user
 * Idempotent: if already a member, returns serverId without error
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { server: true },
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
      { status: 410 }
    );
  }

  const existingMember = await prisma.member.findUnique({
    where: {
      userId_serverId: {
        userId: session.user.id,
        serverId: invite.serverId,
      },
    },
  });

  if (existingMember) {
    return NextResponse.json({ serverId: invite.serverId });
  }

  await prisma.$transaction([
    prisma.member.create({
      data: {
        id: generateId(),
        userId: session.user.id,
        serverId: invite.serverId,
      },
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: { uses: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({ serverId: invite.serverId }, { status: 201 });
}
