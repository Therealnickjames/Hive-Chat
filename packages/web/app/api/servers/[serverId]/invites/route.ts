import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import { generateInviteCode } from "@/lib/invite-code";

/**
 * GET /api/servers/[serverId]/invites — List active invites for a server
 * Auth: server owner only
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

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });

  if (!server || server.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
  }

  const invites = await prisma.invite.findMany({
    where: { serverId },
    include: {
      creator: { select: { username: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    invites: invites.map((inv: {
      id: string;
      code: string;
      maxUses: number | null;
      uses: number;
      expiresAt: Date | null;
      createdAt: Date;
      creator: { username: string; displayName: string };
    }) => ({
      id: inv.id,
      code: inv.code,
      maxUses: inv.maxUses,
      uses: inv.uses,
      expiresAt: inv.expiresAt?.toISOString() || null,
      createdAt: inv.createdAt.toISOString(),
      creatorName: inv.creator.displayName || inv.creator.username,
      isExpired: inv.expiresAt ? inv.expiresAt < new Date() : false,
    })),
  });
}

/**
 * POST /api/servers/[serverId]/invites — Create a new invite
 * Auth: server owner only
 * Body: { maxUses?: number, expiresInHours?: number }
 * Default expiry: 7 days (168 hours)
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

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });

  if (!server || server.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
  }

  let maxUses: number | null = null;
  let expiresInHours = 168;

  try {
    const body = await request.json();
    if (body.maxUses && Number.isInteger(body.maxUses) && body.maxUses > 0) {
      maxUses = body.maxUses;
    }
    if (body.expiresInHours !== undefined) {
      if (body.expiresInHours === null || body.expiresInHours === 0) {
        expiresInHours = 0;
      } else if (
        Number.isFinite(body.expiresInHours) &&
        body.expiresInHours > 0
      ) {
        expiresInHours = body.expiresInHours;
      }
    }
  } catch {
    // Empty body is fine, use defaults.
  }

  const expiresAt =
    expiresInHours > 0
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : null;

  let code: string | null = null;
  for (let attempts = 0; attempts < 5; attempts++) {
    const candidate = generateInviteCode();
    const existing = await prisma.invite.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!existing) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return NextResponse.json(
      { error: "Failed to generate unique invite code" },
      { status: 500 }
    );
  }

  const invite = await prisma.invite.create({
    data: {
      id: generateId(),
      serverId,
      creatorId: session.user.id,
      code,
      maxUses,
      expiresAt,
    },
  });

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        code: invite.code,
        url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/invite/${invite.code}`,
        maxUses: invite.maxUses,
        uses: invite.uses,
        expiresAt: invite.expiresAt?.toISOString() || null,
      },
    },
    { status: 201 }
  );
}
