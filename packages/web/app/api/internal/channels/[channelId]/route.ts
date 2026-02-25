import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/internal/channels/{channelId}
 *
 * Returns:
 * - channel metadata for gateway authorization and sequence recovery
 * - optional membership check when `userId` query param is provided
 *
 * Auth: X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const secret = request.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        serverId: true,
        lastSequence: true,
      },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const response: {
      channelId: string;
      serverId: string;
      lastSequence: number | string;
      isMember?: boolean;
    } = {
      channelId: channel.id,
      serverId: channel.serverId,
      lastSequence: Number(channel.lastSequence),
    };

    if (userId) {
      const member = await prisma.member.findUnique({
        where: {
          userId_serverId: {
            userId,
            serverId: channel.serverId,
          },
        },
      });

      response.isMember = !!member;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to load internal channel:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
