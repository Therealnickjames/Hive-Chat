import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * POST /api/invites/[code]/accept — Join a server via invite
 * Auth: any logged-in user
 * Idempotent: if already a member, returns serverId without error
 *
 * Uses conditional updateMany inside a transaction to prevent
 * maxUses race condition (ISSUE-011).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
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

  // Early check (non-authoritative — the real guard is inside the transaction)
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    return NextResponse.json(
      { error: "Invite has reached max uses" },
      { status: 410 },
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

  // Use interactive transaction to atomically:
  // 1. Conditionally increment invite uses (only if under maxUses)
  // 2. Create member
  // 3. Assign @everyone role
  // All succeed or all roll back. (ISSUE-011)
  const result = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Conditional update: only increment if (maxUses IS NULL OR uses < maxUses)
      const updated = await tx.invite.updateMany({
        where: {
          id: invite.id,
          OR: [{ maxUses: null }, { uses: { lt: invite.maxUses ?? 0 } }],
        },
        data: { uses: { increment: 1 } },
      });

      if (updated.count === 0) {
        // Invite was exhausted between our early check and now
        return { exhausted: true } as const;
      }

      const memberId = generateId();
      await tx.member.create({
        data: {
          id: memberId,
          userId: session.user.id,
          serverId: invite.serverId,
        },
      });

      // Assign @everyone role inside the same transaction (ISSUE-011)
      const everyoneRole = await tx.role.findFirst({
        where: { serverId: invite.serverId, name: "@everyone" },
        select: { id: true },
      });

      if (everyoneRole) {
        await tx.member.update({
          where: { id: memberId },
          data: {
            roles: { connect: { id: everyoneRole.id } },
          },
        });
      }

      return { exhausted: false, serverId: invite.serverId } as const;
    },
  );

  if (result.exhausted) {
    return NextResponse.json(
      { error: "Invite has reached max uses" },
      { status: 410 },
    );
  }

  return NextResponse.json({ serverId: result.serverId }, { status: 201 });
}
