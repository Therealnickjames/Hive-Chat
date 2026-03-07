import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * GET /api/servers/[serverId] — Server detail with channels and member count
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    // Verify user is a member
    const membership = await prisma.member.findUnique({
      where: {
        userId_serverId: {
          userId: session.user.id,
          serverId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        channels: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            topic: true,
            position: true,
            defaultBotId: true,
            channelBots: { select: { botId: true } },
          },
        },
        _count: { select: { members: true } },
      },
    });

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      ownerId: server.ownerId,
      channels: server.channels.map((ch) => ({
        ...ch,
        botIds: ch.channelBots.map((cb: { botId: string }) => cb.botId),
        channelBots: undefined,
      })),
      memberCount: server._count.members,
    });
  } catch (error) {
    console.error("Failed to get server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/servers/[serverId] — Update server settings
 * Requires MANAGE_SERVER permission or owner.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  const check = await checkMemberPermission(
    session.user.id,
    serverId,
    Permissions.MANAGE_SERVER,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Server" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "Server name is required" },
        { status: 400 },
      );
    }
    if (body.name.trim().length > 50) {
      return NextResponse.json(
        { error: "Server name must be 50 characters or fewer" },
        { status: 400 },
      );
    }
    updateData.name = body.name.trim();
  }

  if ("iconUrl" in body) {
    if (body.iconUrl === null) {
      updateData.iconUrl = null;
    } else if (typeof body.iconUrl === "string") {
      if (
        !body.iconUrl.startsWith("/api/uploads/") &&
        !body.iconUrl.startsWith("https://")
      ) {
        return NextResponse.json(
          { error: "iconUrl must be a valid URL or null" },
          { status: 400 },
        );
      }
      updateData.iconUrl = body.iconUrl;
    } else {
      return NextResponse.json(
        { error: "iconUrl must be a string or null" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  try {
    const server = await prisma.server.update({
      where: { id: serverId },
      data: updateData,
    });
    return NextResponse.json({
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      ownerId: server.ownerId,
    });
  } catch (error) {
    console.error("Failed to update server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/servers/[serverId] — Delete a server (owner only)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true },
    });

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    if (server.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the server owner can delete this server" },
        { status: 403 },
      );
    }

    await prisma.server.delete({
      where: { id: serverId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete server:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
