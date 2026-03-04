import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import {
  Permissions,
  serializePermissions,
  deserializePermissions,
} from "@/lib/permissions";

/**
 * PATCH /api/servers/[serverId]/roles/[roleId] — Edit a role
 * Auth: MANAGE_ROLES permission
 * Body: { name?: string, color?: string | null, permissions?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string; roleId: string }> },
) {
  const { serverId, roleId } = await params;
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
    const existingRole = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!existingRole || existingRole.serverId !== serverId) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: {
      name?: string;
      color?: string | null;
      permissions?: bigint;
    } = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();

      if (name.length < 1 || name.length > 50) {
        return NextResponse.json(
          { error: "Role name must be 1-50 characters" },
          { status: 400 },
        );
      }

      if (name === "@everyone" && existingRole.name !== "@everyone") {
        return NextResponse.json(
          { error: "Cannot rename a role to @everyone" },
          { status: 400 },
        );
      }

      if (existingRole.name === "@everyone" && name !== "@everyone") {
        return NextResponse.json(
          { error: "Cannot rename @everyone" },
          { status: 400 },
        );
      }

      updateData.name = name;
    }

    if (body?.color !== undefined) {
      if (body.color === null || body.color === "") {
        updateData.color = null;
      } else {
        updateData.color = String(body.color);
      }
    }

    if (body?.permissions !== undefined) {
      try {
        updateData.permissions = deserializePermissions(
          String(body.permissions),
        );
      } catch {
        return NextResponse.json(
          { error: "permissions must be a valid bigint string" },
          { status: 400 },
        );
      }
    }

    const role = await prisma.role.update({
      where: { id: roleId },
      data: updateData,
    });

    return NextResponse.json({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: serializePermissions(role.permissions),
      position: role.position,
    });
  } catch (error) {
    console.error("Failed to update role:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/servers/[serverId]/roles/[roleId] — Delete a role
 * Auth: MANAGE_ROLES permission
 * Cannot delete @everyone
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string; roleId: string }> },
) {
  const { serverId, roleId } = await params;
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

  const role = await prisma.role.findUnique({
    where: { id: roleId },
  });

  if (!role || role.serverId !== serverId) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  if (role.name === "@everyone") {
    return NextResponse.json(
      { error: "Cannot delete @everyone" },
      { status: 400 },
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
  return NextResponse.json({ success: true });
}
