import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * DELETE /api/servers/{serverId}/members/{memberId}
 *
 * Kick a member from the server.
 * Requires KICK_MEMBERS permission. Cannot kick the owner.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string; memberId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId, memberId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.KICK_MEMBERS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Kick Members" },
      { status: 403 },
    );
  }

  // Find the target member
  const targetMember = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      server: { select: { ownerId: true } },
      user: { select: { id: true, displayName: true } },
    },
  });

  if (!targetMember || targetMember.serverId !== serverId) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Cannot kick the server owner
  if (targetMember.user.id === targetMember.server.ownerId) {
    return NextResponse.json(
      { error: "Cannot kick the server owner" },
      { status: 400 },
    );
  }

  // Cannot kick yourself
  if (targetMember.userId === session.user.id) {
    return NextResponse.json(
      { error: "Cannot kick yourself" },
      { status: 400 },
    );
  }

  try {
    await prisma.member.delete({ where: { id: memberId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to kick member:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
