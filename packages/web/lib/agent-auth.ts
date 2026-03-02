import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Agent authentication result — returned on successful API key validation.
 * Used by all /api/v1/agents/* and /api/v1/webhooks/* endpoints.
 */
export interface AgentAuthResult {
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  serverId: string;
  capabilities: unknown;
  connectionMethod: string;
}

/**
 * Validate Bearer sk-tvk-... header and return agent info.
 *
 * Used by all /api/v1/ endpoints that require agent identity.
 * Mirrors the logic in /api/internal/agents/verify but returns richer data
 * and is callable directly from Next.js route handlers.
 *
 * @returns AgentAuthResult on success, null on failure
 */
export async function authenticateAgentRequest(
  request: NextRequest
): Promise<AgentAuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer sk-tvk-")) {
    return null;
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer "
  const apiKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");

  const registration = await prisma.agentRegistration.findFirst({
    where: { apiKeyHash },
    select: {
      botId: true,
      capabilities: true,
      connectionMethod: true,
      bot: {
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

  if (!registration || !registration.bot.isActive) {
    return null;
  }

  return {
    botId: registration.botId,
    botName: registration.bot.name,
    botAvatarUrl: registration.bot.avatarUrl,
    serverId: registration.bot.serverId,
    capabilities: registration.capabilities,
    connectionMethod: registration.connectionMethod,
  };
}

/**
 * Validate an API key string directly (not from request headers).
 * Used by endpoints that receive the key via query parameters or URL tokens.
 */
export async function authenticateAgentKey(
  apiKey: string
): Promise<AgentAuthResult | null> {
  if (!apiKey.startsWith("sk-tvk-")) {
    return null;
  }

  const apiKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");

  const registration = await prisma.agentRegistration.findFirst({
    where: { apiKeyHash },
    select: {
      botId: true,
      capabilities: true,
      connectionMethod: true,
      bot: {
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

  if (!registration || !registration.bot.isActive) {
    return null;
  }

  return {
    botId: registration.botId,
    botName: registration.bot.name,
    botAvatarUrl: registration.bot.avatarUrl,
    serverId: registration.bot.serverId,
    capabilities: registration.capabilities,
    connectionMethod: registration.connectionMethod,
  };
}
