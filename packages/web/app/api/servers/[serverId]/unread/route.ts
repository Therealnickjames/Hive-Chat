import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/servers/[serverId]/unread
 *
 * Get unread state for all channels in a server. (TASK-0016)
 * Compares each channel's lastSequence with the user's ChannelReadState.lastReadSeq.
 * Returns hasUnread flag and mentionCount per channel.
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

  // Verify membership
  const member = await prisma.member.findUnique({
    where: {
      userId_serverId: { userId: session.user.id, serverId },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Fetch all channels with their lastSequence
  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true, lastSequence: true },
  });

  // Fetch user's read states for this server's channels
  const channelIds = channels.map((c) => c.id);
  const readStates = await prisma.channelReadState.findMany({
    where: {
      userId: session.user.id,
      channelId: { in: channelIds },
    },
    select: { channelId: true, lastReadSeq: true, mentionCount: true },
  });

  // Build a lookup map
  const readStateMap = new Map(
    readStates.map((rs) => [rs.channelId, rs])
  );

  // Compute unread state per channel
  const result = channels.map((channel) => {
    const readState = readStateMap.get(channel.id);
    const lastSeq = channel.lastSequence ?? BigInt(0);
    const lastReadSeq = readState?.lastReadSeq ?? BigInt(0);

    return {
      channelId: channel.id,
      hasUnread: lastSeq > lastReadSeq,
      mentionCount: readState?.mentionCount ?? 0,
      lastReadSeq: lastReadSeq.toString(),
    };
  });

  return NextResponse.json({ channels: result });
}
