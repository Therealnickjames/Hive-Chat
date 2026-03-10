import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateInternalSecret } from "@/lib/internal-auth";
import crypto from "crypto";

/**
 * GET /api/internal/agents/verify?api_key=sk-tvk-...
 *
 * Called by the Elixir Gateway on WebSocket connect to verify an agent's API key.
 * Returns agent info on success (id, name, serverId) so the Gateway can assign
 * socket state without another round-trip.
 *
 * Auth: X-Internal-Secret header (same as other internal APIs).
 * DEC-0040: Agent self-registration
 */
export async function GET(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const apiKey = searchParams.get("api_key");

  if (!apiKey || !apiKey.startsWith("sk-tvk-")) {
    return NextResponse.json(
      { error: "Invalid API key format" },
      { status: 400 },
    );
  }

  // SHA-256 hash for indexed lookup
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  try {
    const registration = await prisma.agentRegistration.findFirst({
      where: { apiKeyHash },
      select: {
        id: true,
        capabilities: true,
        agent: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            serverId: true,
            isActive: true,
          },
        },
      },
    });

    if (!registration) {
      return NextResponse.json(
        { error: "Agent not found", valid: false },
        { status: 404 },
      );
    }

    if (!registration.agent.isActive) {
      return NextResponse.json(
        { error: "Agent is deactivated", valid: false },
        { status: 403 },
      );
    }

    return NextResponse.json({
      valid: true,
      agentId: registration.agent.id,
      agentName: registration.agent.name,
      agentAvatarUrl: registration.agent.avatarUrl,
      serverId: registration.agent.serverId,
      capabilities: registration.capabilities,
    });
  } catch (error) {
    console.error("Agent verification failed:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
