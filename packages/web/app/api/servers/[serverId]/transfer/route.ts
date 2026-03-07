import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/servers/{serverId}/transfer
 *
 * Transfer server ownership to another member.
 * Owner only.
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

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  if (server.ownerId !== session.user.id) {
    return NextResponse.json(
      { error: "Only the server owner can transfer ownership" },
      { status: 403 },
    );
  }

  let body: { newOwnerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { newOwnerId } = body;
  if (typeof newOwnerId !== "string" || newOwnerId.length === 0) {
    return NextResponse.json(
      { error: "newOwnerId is required" },
      { status: 400 },
    );
  }

  if (newOwnerId === session.user.id) {
    return NextResponse.json(
      { error: "You are already the owner" },
      { status: 400 },
    );
  }

  // Verify target is a member
  const targetMember = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId: newOwnerId, serverId },
    },
  });

  if (!targetMember) {
    return NextResponse.json(
      { error: "Target user is not a member of this server" },
      { status: 400 },
    );
  }

  try {
    await prisma.server.update({
      where: { id: serverId },
      data: { ownerId: newOwnerId },
    });

    return NextResponse.json({ ok: true, newOwnerId });
  } catch (error) {
    console.error("Failed to transfer ownership:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
