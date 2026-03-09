import { ulid } from "ulid";
import crypto from "crypto";
import { prisma } from "@/lib/db";

/**
 * Shared agent creation logic — used by both:
 * - POST /api/servers/{serverId}/bots (UI-initiated, session auth)
 * - POST /api/v1/bootstrap/agents (CLI-initiated, admin token auth)
 *
 * Creates a Bot + AgentRegistration in a transaction, returns
 * the raw API key (shown once, never stored).
 */

export const VALID_CONNECTION_METHODS = [
  "WEBSOCKET",
  "WEBHOOK",
  "INBOUND_WEBHOOK",
  "REST_POLL",
  "SSE",
  "OPENAI_COMPAT",
] as const;

export type ConnectionMethodValue = (typeof VALID_CONNECTION_METHODS)[number];

export interface CreateAgentOptions {
  name: string;
  serverId: string;
  connectionMethod: ConnectionMethodValue;
  triggerMode?: string;
  webhookUrl?: string;
  capabilities?: string[];
  systemPrompt?: string;
}

export interface CreateAgentResult {
  bot: { id: string; name: string };
  apiKey: string; // raw key — shown once, never stored
  connectionMethod: ConnectionMethodValue;
  webhookSecret?: string; // for WEBHOOK method only
}

/**
 * Create an agent (Bot + AgentRegistration) with a generated API key.
 *
 * The raw API key is returned in the result and must be shown to the user
 * exactly once. Only the SHA-256 hash is stored in the database.
 *
 * @throws Error if the database transaction fails
 */
export async function createAgent(
  opts: CreateAgentOptions,
): Promise<CreateAgentResult> {
  const botId = ulid();
  const registrationId = ulid();

  // Generate API key: sk-tvk- prefix + 32 random bytes base64url
  const randomBytes = crypto.randomBytes(32);
  const apiKey = `sk-tvk-${randomBytes.toString("base64url")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  // Generate webhook secret for WEBHOOK method
  const webhookSecret =
    opts.connectionMethod === "WEBHOOK"
      ? crypto.randomBytes(32).toString("hex")
      : undefined;

  const result = await prisma.$transaction(async (tx) => {
    const bot = await tx.bot.create({
      data: {
        id: botId,
        name: opts.name,
        serverId: opts.serverId,
        llmProvider: "custom",
        llmModel: "custom",
        apiEndpoint: "",
        apiKeyEncrypted: "",
        systemPrompt: opts.systemPrompt || "",
        temperature: 0.7,
        maxTokens: 4096,
        isActive: true,
        triggerMode: (opts.triggerMode || "MENTION") as
          | "ALWAYS"
          | "MENTION"
          | "KEYWORD",
        connectionMethod: opts.connectionMethod,
      },
    });

    await tx.agentRegistration.create({
      data: {
        id: registrationId,
        botId: bot.id,
        apiKeyHash,
        capabilities: Array.isArray(opts.capabilities)
          ? opts.capabilities
          : [],
        webhookUrl: opts.webhookUrl,
        connectionMethod: opts.connectionMethod,
        webhookSecret,
      },
    });

    return { bot };
  });

  return {
    bot: { id: result.bot.id, name: result.bot.name },
    apiKey,
    connectionMethod: opts.connectionMethod,
    webhookSecret,
  };
}

/**
 * Build method-specific connection URLs for an agent.
 *
 * Used by both the bots route and the bootstrap/agents route
 * to return connection info after agent creation.
 */
export function buildConnectionInfo(
  agentId: string,
  connectionMethod: ConnectionMethodValue,
  opts?: { webhookUrl?: string; webhookSecret?: string },
): Record<string, string | undefined> {
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:4001/socket";
  const webUrl = process.env.NEXTAUTH_URL || "http://localhost:5555";

  const info: Record<string, string | undefined> = {};

  switch (connectionMethod) {
    case "WEBSOCKET":
      info.websocketUrl = `${gatewayUrl}/websocket`;
      break;
    case "WEBHOOK":
      info.webhookUrl = opts?.webhookUrl;
      info.webhookSecret = opts?.webhookSecret;
      break;
    case "REST_POLL":
      info.pollUrl = `${webUrl}/api/v1/agents/${agentId}/messages`;
      break;
    case "SSE":
      info.eventsUrl = `${webUrl}/api/v1/agents/${agentId}/events`;
      break;
    case "OPENAI_COMPAT":
      info.chatCompletionsUrl = `${webUrl}/api/v1/chat/completions`;
      info.modelsUrl = `${webUrl}/api/v1/models`;
      break;
  }

  return info;
}
