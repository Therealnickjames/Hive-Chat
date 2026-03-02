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
  agentId: string
): Promise<{ authorized: boolean; error?: string; status?: number }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "Missing Authorization header", status: 401 };
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer "
  const crypto = await import("crypto");
  const apiKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");

  const registration = await prisma.agentRegistration.findFirst({
    where: { apiKeyHash, botId: agentId },
    select: { id: true, botId: true },
  });

  if (!registration) {
    return { authorized: false, error: "Invalid API key", status: 401 };
  }

  return { authorized: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const bot = await prisma.bot.findUnique({
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

  if (!bot || !bot.agentRegistration) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    agentId: bot.id,
    displayName: bot.name,
    avatarUrl: bot.avatarUrl,
    serverId: bot.serverId,
    model: bot.llmModel,
    isActive: bot.isActive,
    triggerMode: bot.triggerMode,
    capabilities: bot.agentRegistration.capabilities,
    healthUrl: bot.agentRegistration.healthUrl,
    webhookUrl: bot.agentRegistration.webhookUrl,
    maxTokensSec: bot.agentRegistration.maxTokensSec,
    lastHealthCheck: bot.agentRegistration.lastHealthCheck,
    lastHealthOk: bot.agentRegistration.lastHealthOk,
    connectionMethod: bot.agentRegistration.connectionMethod,
    createdAt: bot.createdAt,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateAgent(request, id);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { displayName, avatarUrl, capabilities, healthUrl, webhookUrl, maxTokensSec } =
    body as {
      displayName?: string;
      avatarUrl?: string;
      capabilities?: string[];
      healthUrl?: string;
      webhookUrl?: string;
      maxTokensSec?: number;
    };

  try {
    await prisma.$transaction(async (tx) => {
      // Update Bot fields if provided
      const botUpdate: Record<string, unknown> = {};
      if (displayName !== undefined) botUpdate.name = displayName;
      if (avatarUrl !== undefined) botUpdate.avatarUrl = avatarUrl;

      if (Object.keys(botUpdate).length > 0) {
        await tx.bot.update({ where: { id }, data: botUpdate });
      }

      // Update AgentRegistration fields if provided
      const regUpdate: Record<string, unknown> = {};
      if (capabilities !== undefined) regUpdate.capabilities = capabilities;
      if (healthUrl !== undefined) regUpdate.healthUrl = healthUrl;
      if (webhookUrl !== undefined) regUpdate.webhookUrl = webhookUrl;
      if (maxTokensSec !== undefined) regUpdate.maxTokensSec = maxTokensSec;

      if (Object.keys(regUpdate).length > 0) {
        await tx.agentRegistration.update({
          where: { botId: id },
          data: regUpdate,
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Agent update failed:", error);
    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateAgent(request, id);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  try {
    // Delete Bot — AgentRegistration cascades via onDelete: Cascade
    await prisma.bot.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Agent deregistration failed:", error);
    return NextResponse.json(
      { error: "Deregistration failed" },
      { status: 500 }
    );
  }
}
