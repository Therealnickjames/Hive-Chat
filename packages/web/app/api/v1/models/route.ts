import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAgentRequest } from "@/lib/agent-auth";

/**
 * GET /api/v1/models — List available models (OpenAI-compatible) (DEC-0046)
 *
 * Returns channels the agent can access as "models" in OpenAI format.
 * This makes `client.models.list()` work in any OpenAI SDK.
 *
 * Auth: Authorization: Bearer sk-tvk-...
 */
export async function GET(request: NextRequest) {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid or missing API key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      },
      { status: 401 }
    );
  }

  try {
    // Get all channels in the agent's server
    const channels = await prisma.channel.findMany({
      where: { serverId: agent.serverId },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
      orderBy: { position: "asc" },
    });

    const models = channels.map((ch) => ({
      id: `tavok-channel-${ch.id}`,
      object: "model" as const,
      created: Math.floor(ch.createdAt.getTime() / 1000),
      owned_by: "tavok",
      permission: [],
    }));

    return NextResponse.json({
      object: "list",
      data: models,
    });
  } catch (error) {
    console.error("Models list failed:", error);
    return NextResponse.json(
      {
        error: {
          message: "Failed to list models",
          type: "server_error",
          code: "internal_error",
        },
      },
      { status: 500 }
    );
  }
}
