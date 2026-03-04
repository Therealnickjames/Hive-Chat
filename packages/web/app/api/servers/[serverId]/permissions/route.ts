import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  computeMemberPermissions,
  serializePermissions,
} from "@/lib/permissions";

/**
 * GET /api/servers/[serverId]/permissions — Get current user's permissions
 * Returns effective permissions and isOwner flag
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const { serverId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId: session.user.id, serverId },
    },
    include: {
      roles: { select: { permissions: true } },
      server: { select: { ownerId: true } },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const isOwner = session.user.id === member.server.ownerId;
  const effectivePermissions = computeMemberPermissions(
    session.user.id,
    member.server.ownerId,
    member.roles,
  );

  return NextResponse.json({
    permissions: serializePermissions(effectivePermissions),
    isOwner,
  });
}
