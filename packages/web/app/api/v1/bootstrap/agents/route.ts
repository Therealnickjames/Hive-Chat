import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminToken } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import {
  createAgent,
  buildConnectionInfo,
  VALID_CONNECTION_METHODS,
  type ConnectionMethodValue,
} from "@/lib/agent-factory";

/**
 * POST /api/v1/bootstrap/agents — CLI-initiated agent creation
 *
 * Creates an agent (Bot + AgentRegistration) using admin token auth.
 * Used by `tavok init` to set up agents without a user session.
 *
 * Auth: Authorization: Bearer admin-{TAVOK_ADMIN_TOKEN}
 *
 * Body:
 *   name       — required, display name for the agent
 *   serverId   — required, which server to add the agent to
 *   connectionMethod — optional, defaults to WEBSOCKET
 *   webhookUrl — optional, only for WEBHOOK agents
 *
 * Returns the raw API key (shown once, never stored).
 */
export async function POST(request: NextRequest) {
  // Admin token auth (same as bootstrap endpoint)
  if (!authenticateAdminToken(request)) {
    return NextResponse.json(
      { error: "Invalid or missing admin token" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, serverId, connectionMethod, webhookUrl } = body as {
    name?: string;
    serverId?: string;
    connectionMethod?: string;
    webhookUrl?: string;
  };

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }

  if (!serverId || typeof serverId !== "string") {
    return NextResponse.json(
      { error: "serverId is required" },
      { status: 400 },
    );
  }

  // Verify server exists
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true },
  });

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  // Resolve connection method (default WEBSOCKET)
  const resolvedMethod: ConnectionMethodValue =
    connectionMethod &&
    VALID_CONNECTION_METHODS.includes(
      connectionMethod as ConnectionMethodValue,
    )
      ? (connectionMethod as ConnectionMethodValue)
      : "WEBSOCKET";

  try {
    const result = await createAgent({
      name: name.trim(),
      serverId,
      connectionMethod: resolvedMethod,
      webhookUrl,
    });

    const connectionInfo = buildConnectionInfo(
      result.bot.id,
      result.connectionMethod,
      {
        webhookUrl,
        webhookSecret: result.webhookSecret,
      },
    );

    return NextResponse.json(
      {
        id: result.bot.id,
        name: result.bot.name,
        apiKey: result.apiKey,
        serverId,
        connectionMethod: result.connectionMethod,
        ...connectionInfo,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Bootstrap agent creation failed:", error);
    return NextResponse.json(
      { error: "Agent creation failed" },
      { status: 500 },
    );
  }
}
