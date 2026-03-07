import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * PUT /api/servers/{serverId}/channels/reorder
 *
 * Reorder channels by providing an array of channel IDs in desired order.
 * Requires MANAGE_CHANNELS permission.
 */
export async function PUT(
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
    Permissions.MANAGE_CHANNELS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Channels" },
      { status: 403 },
    );
  }

  let body: { channelIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelIds } = body;
  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return NextResponse.json(
      { error: "channelIds must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  // Verify all channels belong to this server
  const serverChannels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  const serverChannelIds = new Set(serverChannels.map((c) => c.id));
  const invalid = (channelIds as string[]).filter(
    (id) => !serverChannelIds.has(id),
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Channels not found in this server: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  // Update positions in a transaction
  try {
    await prisma.$transaction(
      (channelIds as string[]).map((id, index) =>
        prisma.channel.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to reorder channels:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
