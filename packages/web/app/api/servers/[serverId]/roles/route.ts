import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import {
  checkMemberPermission,
  checkMembership,
} from "@/lib/check-member-permission";
import {
  Permissions,
  serializePermissions,
  deserializePermissions,
} from "@/lib/permissions";

/**
 * GET /api/servers/[serverId]/roles — List all roles
 * Auth: any server member
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isMember } = await checkMembership(session.user.id, serverId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const roles = await prisma.role.findMany({
    where: { serverId },
    include: {
      _count: { select: { members: true } },
    },
    orderBy: [{ position: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: serializePermissions(role.permissions),
      position: role.position,
      memberCount: role._count.members,
      isEveryone: role.name === "@everyone",
    })),
  });
}

/**
 * POST /api/servers/[serverId]/roles — Create a new role
 * Auth: MANAGE_ROLES permission
 * Body: { name: string, color?: string, permissions?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_ROLES
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Roles" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const name = body?.name?.trim();

    if (!name || name.length < 1 || name.length > 50) {
      return NextResponse.json(
        { error: "Role name must be 1-50 characters" },
        { status: 400 }
      );
    }

    if (name === "@everyone") {
      return NextResponse.json(
        { error: "Cannot create a role named @everyone" },
        { status: 400 }
      );
    }

    const highestRole = await prisma.role.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const newPosition = (highestRole?.position ?? 0) + 1;

    let permissions = BigInt(0);
    if (body?.permissions !== undefined) {
      try {
        permissions = deserializePermissions(String(body.permissions));
      } catch {
        return NextResponse.json(
          { error: "permissions must be a valid bigint string" },
          { status: 400 }
        );
      }
    }

    const color =
      typeof body?.color === "string" && body.color.trim()
        ? body.color.trim()
        : null;

    const role = await prisma.role.create({
      data: {
        id: generateId(),
        serverId,
        name,
        color,
        permissions,
        position: newPosition,
      },
    });

    return NextResponse.json(
      {
        id: role.id,
        name: role.name,
        color: role.color,
        permissions: serializePermissions(role.permissions),
        position: role.position,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create role:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
