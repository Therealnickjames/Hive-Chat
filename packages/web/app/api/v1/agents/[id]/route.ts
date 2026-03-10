import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/v1/agents/{id} — Get agent info
 * PATCH /api/v1/agents/{id} — Update agent
 * DELETE /api/v1/agents/{id} — Deregister agent
 *
 * All routes require API key auth via Authorization header:
 *   Authorization: Bearer sk-tvk-...
 *
 * DEC-0040: Agent self-registration
 */

/** Verify the request comes from the agent that owns this registration */
async function authenticateAgent(
  request: NextRequest,
  agentId: string,
): Promise<{ authorized: boolean; error?: string; status?: number }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      authorized: false,
      error: "Missing Authorization header",
      status: 401,
    };
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer "
  const crypto = await import("crypto");
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  const registration = await prisma.agentRegistration.findFirst({
    where: { apiKeyHash, agentId },
    select: { id: true, agentId: true },
  });

  if (!registration) {
    return { authorized: false, error: "Invalid API key", status: 401 };
  }

  return { authorized: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      serverId: true,
      llmModel: true,
      isActive: true,
      triggerMode: true,
      createdAt: true,
      agentRegistration: {
        select: {
          capabilities: true,
          healthUrl: true,
          webhookUrl: true,
          maxTokensSec: true,
          lastHealthCheck: true,
          lastHealthOk: true,
          connectionMethod: true,
        },
      },
    },
  });

  if (!agent || !agent.agentRegistration) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({
    agentId: agent.id,
    displayName: agent.name,
    avatarUrl: agent.avatarUrl,
    serverId: agent.serverId,
    model: agent.llmModel,
    isActive: agent.isActive,
    triggerMode: agent.triggerMode,
    capabilities: agent.agentRegistration.capabilities,
    healthUrl: agent.agentRegistration.healthUrl,
    webhookUrl: agent.agentRegistration.webhookUrl,
    maxTokensSec: agent.agentRegistration.maxTokensSec,
    lastHealthCheck: agent.agentRegistration.lastHealthCheck,
    lastHealthOk: agent.agentRegistration.lastHealthOk,
    connectionMethod: agent.agentRegistration.connectionMethod,
    createdAt: agent.createdAt,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authenticateAgent(request, id);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    displayName,
    avatarUrl,
    capabilities,
    healthUrl,
    webhookUrl,
    maxTokensSec,
  } = body as {
    displayName?: string;
    avatarUrl?: string;
    capabilities?: string[];
    healthUrl?: string;
    webhookUrl?: string;
    maxTokensSec?: number;
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Update Agent fields if provided
      const agentUpdate: Record<string, unknown> = {};
      if (displayName !== undefined) agentUpdate.name = displayName;
      if (avatarUrl !== undefined) agentUpdate.avatarUrl = avatarUrl;

      if (Object.keys(agentUpdate).length > 0) {
        await tx.agent.update({ where: { id }, data: agentUpdate });
      }

      // Update AgentRegistration fields if provided
      const regUpdate: Record<string, unknown> = {};
      if (capabilities !== undefined) regUpdate.capabilities = capabilities;
      if (healthUrl !== undefined) regUpdate.healthUrl = healthUrl;
      if (webhookUrl !== undefined) regUpdate.webhookUrl = webhookUrl;
      if (maxTokensSec !== undefined) regUpdate.maxTokensSec = maxTokensSec;

      if (Object.keys(regUpdate).length > 0) {
        await tx.agentRegistration.update({
          where: { agentId: id },
          data: regUpdate,
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Agent update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authenticateAgent(request, id);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Delete Agent — AgentRegistration cascades via onDelete: Cascade
    await prisma.agent.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Agent deregistration failed:", error);
    return NextResponse.json(
      { error: "Deregistration failed" },
      { status: 500 },
    );
  }
}
