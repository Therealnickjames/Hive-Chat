import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";

/**
 * POST /api/servers/[serverId]/channels/[channelId]/read
 *
 * Mark a channel as read for the current user. (TASK-0016)
 * Upserts ChannelReadState: sets lastReadSeq = channel's current lastSequence,
 * resets mentionCount to 0.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string }> },
) {
  const { serverId, channelId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify membership
  const member = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId: session.user.id, serverId },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Get current channel lastSequence
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { lastSequence: true, serverId: true },
  });

  if (!channel || channel.serverId !== serverId) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Upsert read state
  await prisma.channelReadState.upsert({
    where: {
      userId_channelId: {
        userId: session.user.id,
        channelId,
      },
    },
    create: {
      id: generateId(),
      userId: session.user.id,
      channelId,
      lastReadSeq: channel.lastSequence ?? BigInt(0),
      mentionCount: 0,
    },
    update: {
      lastReadSeq: channel.lastSequence ?? BigInt(0),
      mentionCount: 0,
    },
  });

  return NextResponse.json({ ok: true });
}
