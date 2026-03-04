import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkMemberPermission } from "@/lib/check-member-permission";
import { Permissions } from "@/lib/permissions";

/**
 * GET /api/servers/{serverId}/agent-settings — Read agent registration settings
 * PATCH /api/servers/{serverId}/agent-settings — Update settings (MANAGE_BOTS)
 *
 * DEC-0047: Server-controlled registration gating
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverId } = await params;

  // Verify membership
  const member = await prisma.member.findUnique({
    where: { userId_serverId: { userId: session.user.id, serverId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: {
      allowAgentRegistration: true,
      registrationApprovalRequired: true,
    },
  });

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  return NextResponse.json(server);
}

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
    Permissions.MANAGE_BOTS,
  );
  if (!check.allowed) {
    return NextResponse.json(
      { error: "Missing permission: Manage Bots" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, boolean> = {};

  if (typeof body.allowAgentRegistration === "boolean") {
    data.allowAgentRegistration = body.allowAgentRegistration;
  }
  if (typeof body.registrationApprovalRequired === "boolean") {
    data.registrationApprovalRequired = body.registrationApprovalRequired;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const server = await prisma.server.update({
    where: { id: serverId },
    data,
    select: {
      allowAgentRegistration: true,
      registrationApprovalRequired: true,
    },
  });

  return NextResponse.json(server);
}
