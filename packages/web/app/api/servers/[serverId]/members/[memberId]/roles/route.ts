import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * PUT /api/servers/[serverId]/members/[memberId]/roles
 * Body: { roleIds: string[] }
 * Auth: MANAGE_ROLES permission
 * Sets the member's roles to exactly the provided list.
 * @everyone is always included and cannot be removed.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; memberId: string }> },
) {
  const { serverId, memberId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_ROLES,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Roles" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const providedRoleIds: string[] = Array.isArray(body?.roleIds)
      ? body.roleIds.filter(
          (id: unknown): id is string => typeof id === "string",
        )
      : [];

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, serverId: true },
    });
    if (!member || member.serverId !== serverId) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const everyoneRole = await prisma.role.findFirst({
      where: { serverId, name: "@everyone" },
      select: { id: true },
    });

    const desiredRoleIds = new Set<string>(providedRoleIds);
    if (everyoneRole) {
      desiredRoleIds.add(everyoneRole.id);
    }

    const validRoles = await prisma.role.findMany({
      where: { id: { in: Array.from(desiredRoleIds.values()) }, serverId },
      select: { id: true },
    });
    const validRoleIds = validRoles.map((role) => role.id);

    await prisma.member.update({
      where: { id: memberId },
      data: {
        roles: {
          set: validRoleIds.map((id) => ({ id })),
        },
      },
    });

    return NextResponse.json({ success: true, roleIds: validRoleIds });
  } catch (error) {
    console.error("Failed to update member roles:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
