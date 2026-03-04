import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * GET /api/servers/[serverId]/channels — List channels for a server
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
    // Verify membership
    const membership = await prisma.member.findUnique({
      where: {
        userId_serverId: { userId: session.user.id, serverId },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const channels = await prisma.channel.findMany({
      where: { serverId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        topic: true,
        position: true,
      },
    });

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Failed to list channels:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/channels — Create a new channel
 * Body: { name: string; topic?: string | null; type?: "TEXT" | "ANNOUNCEMENT" }
 * Requires MANAGE_CHANNELS permission
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    const check = await checkMemberPermission(
      session.user.id,
      serverId,
      Permissions.MANAGE_CHANNELS,
    );
    if (!check.allowed) {
      return NextResponse.json(
        { error: "Missing permission: Manage Channels" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const name = body.name?.trim()?.toLowerCase()?.replace(/\s+/g, "-");
    const topic =
      typeof body.topic === "string" && body.topic.trim().length > 0
        ? body.topic.trim().slice(0, 300)
        : null;
    const type = body.type === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "TEXT";

    if (!name || name.length < 1 || name.length > 100) {
      return NextResponse.json(
        { error: "Channel name must be 1-100 characters" },
        { status: 400 },
      );
    }

    // Get next position
    const lastChannel = await prisma.channel.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (lastChannel?.position ?? -1) + 1;

    const channel = await prisma.channel.create({
      data: {
        id: generateId(),
        serverId,
        name,
        topic,
        type,
        position: nextPosition,
      },
    });

    return NextResponse.json(
      {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        topic: channel.topic,
        position: channel.position,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create channel:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
