import { NextResponse } from "next/server.js";
import {
  buildMonotonicLastSequenceUpdate,
  canMutateServerScopedResource,
  isJsonObjectBody,
  parseNonNegativeSequence,
  serializeSequence,
} from "./api-safety.js";
import { parseMentionedUserIds } from "./mention-parser";
import { generateId } from "./ulid";
import crypto from "crypto";

function isAuthorType(value) {
  return value === "USER" || value === "BOT" || value === "SYSTEM";
}

function isMessageType(value) {
  return (
    value === "STANDARD" ||
    value === "STREAMING" ||
    value === "SYSTEM" ||
    value === "TOOL_CALL" ||
    value === "TOOL_RESULT" ||
    value === "CODE_BLOCK" ||
    value === "ARTIFACT" ||
    value === "STATUS"
  );
}

function isStreamingStatus(value) {
  return value === "ACTIVE" || value === "COMPLETE" || value === "ERROR";
}

function extractAttachmentIds(content) {
  const ids = [];
  const regex = /\[file:([^:\]]+):[^:\]]+:[^\]]+\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

export function createInternalMessagesPostHandler({ prismaClient }) {
  return async function internalMessagesPostHandler(request) {
    const secret = request.headers.get("x-internal-secret");
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }
      body = parsedBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id = body.id;
    const channelId = body.channelId;
    const authorId = body.authorId;
    const authorType = body.authorType;
    const content = body.content;
    const type = body.type;
    const streamingStatus = body.streamingStatus;
    const sequenceValue = body.sequence;

    if (
      typeof id !== "string" ||
      typeof channelId !== "string" ||
      typeof authorId !== "string" ||
      !isAuthorType(authorType) ||
      typeof content !== "string" ||
      !isMessageType(type) ||
      (streamingStatus !== undefined &&
        streamingStatus !== null &&
        !isStreamingStatus(streamingStatus)) ||
      (typeof sequenceValue !== "string" &&
        typeof sequenceValue !== "number" &&
        typeof sequenceValue !== "bigint")
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const sequenceBigInt = parseNonNegativeSequence(sequenceValue);
    if (sequenceBigInt === null) {
      return NextResponse.json(
        { error: "sequence must be a non-negative integer string" },
        { status: 400 },
      );
    }

    const metadata = body.metadata; // TASK-0039: agent execution metadata (optional)
    const attachmentIds =
      authorType === "USER" ? extractAttachmentIds(content) : [];

    try {
      const [message] = await prismaClient.$transaction(async (tx) => {
        const createData = {
          id,
          channelId,
          authorId,
          authorType,
          content,
          type,
          streamingStatus: streamingStatus ?? null,
          sequence: sequenceBigInt,
        };
        if (metadata !== undefined && metadata !== null) {
          createData.metadata = metadata;
        }
        const createdMessage = await tx.message.create({
          data: createData,
        });

        if (attachmentIds.length > 0) {
          await tx.attachment.updateMany({
            where: {
              id: { in: attachmentIds },
              userId: authorId,
              messageId: null,
            },
            data: { messageId: createdMessage.id },
          });
        }

        await tx.channel.updateMany({
          ...buildMonotonicLastSequenceUpdate(channelId, sequenceBigInt),
        });

        return [createdMessage];
      });

      // TASK-0015: Extract and persist @mentions for USER messages.
      // Runs outside the transaction (non-blocking, best-effort).
      if (authorType === "USER" && content.includes("@")) {
        try {
          // Fetch server members and bots via the channel's serverId
          const channel = await prismaClient.channel.findUnique({
            where: { id: channelId },
            select: { serverId: true },
          });

          if (channel) {
            const [serverMembers, serverBots] = await Promise.all([
              prismaClient.member.findMany({
                where: { serverId: channel.serverId },
                select: {
                  userId: true,
                  user: { select: { displayName: true } },
                },
              }),
              prismaClient.bot.findMany({
                where: { serverId: channel.serverId, isActive: true },
                select: { id: true, name: true },
              }),
            ]);

            const memberTargets = serverMembers.map((m) => ({
              id: m.userId,
              name: m.user.displayName,
            }));
            const botTargets = serverBots.map((b) => ({
              id: b.id,
              name: b.name,
            }));

            const mentionedIds = parseMentionedUserIds(
              content,
              memberTargets,
              botTargets,
            );

            if (mentionedIds.length > 0) {
              await prismaClient.messageMention.createMany({
                data: mentionedIds.map((userId) => ({
                  id: generateId(),
                  messageId: id,
                  userId,
                })),
                skipDuplicates: true,
              });

              // TASK-0016: Increment mentionCount for mentioned users (excluding author).
              // Users who don't have a ChannelReadState yet: updateMany affects 0 rows — fine for V1.
              const mentionedOthers = mentionedIds.filter(
                (uid) => uid !== authorId,
              );
              if (mentionedOthers.length > 0) {
                await prismaClient.channelReadState.updateMany({
                  where: {
                    channelId,
                    userId: { in: mentionedOthers },
                  },
                  data: {
                    mentionCount: { increment: 1 },
                  },
                });
              }
            }
          }
        } catch (mentionError) {
          // Non-fatal: log and continue — message is already persisted
          console.error("[Mentions] Failed to persist mentions:", mentionError);
        }
      }

      let authorName = "Unknown";
      let authorAvatarUrl = null;

      if (authorType === "USER") {
        const user = await prismaClient.user.findUnique({
          where: { id: authorId },
          select: { displayName: true, avatarUrl: true },
        });
        if (user) {
          authorName = user.displayName;
          authorAvatarUrl = user.avatarUrl;
        }
      } else if (authorType === "BOT") {
        const bot = await prismaClient.bot.findUnique({
          where: { id: authorId },
          select: { name: true, avatarUrl: true },
        });
        if (bot) {
          authorName = bot.name;
          authorAvatarUrl = bot.avatarUrl;
        }
      }

      return NextResponse.json(
        {
          id: message.id,
          channelId: message.channelId,
          authorId: message.authorId,
          authorType: message.authorType,
          authorName,
          authorAvatarUrl,
          content: message.content,
          type: message.type,
          streamingStatus: message.streamingStatus,
          sequence: serializeSequence(message.sequence),
          createdAt: message.createdAt.toISOString(),
          reactions: [],
        },
        { status: 201 },
      );
    } catch (error) {
      // P2002 = Prisma unique constraint violation (duplicate message ID).
      // Return 409 so Gateway retry logic treats it as success (idempotency).
      if (error?.code === "P2002") {
        return NextResponse.json(
          { error: "Message already exists" },
          { status: 409 },
        );
      }
      console.error("Failed to persist message:", error);
      return NextResponse.json(
        { error: "Failed to persist message" },
        { status: 500 },
      );
    }
  };
}

export function createServerBotPatchHandler({
  getServerSession,
  authOptions,
  prismaClient,
  encrypt,
}) {
  return async function serverBotPatchHandler(request, { params }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { serverId, botId } = await params;

    const server = await prismaClient.server.findUnique({
      where: { id: serverId },
    });
    if (!server || server.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Not the server owner" },
        { status: 403 },
      );
    }

    const existingBot = await prismaClient.bot.findUnique({
      where: { id: botId },
      select: { serverId: true },
    });
    if (
      !existingBot ||
      !canMutateServerScopedResource(serverId, existingBot.serverId)
    ) {
      return NextResponse.json(
        { error: "Bot not found in this server" },
        { status: 404 },
      );
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }
      body = parsedBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updateData = {};
    const allowedFields = [
      "name",
      "llmProvider",
      "llmModel",
      "apiEndpoint",
      "systemPrompt",
      "temperature",
      "maxTokens",
      "isActive",
      "triggerMode",
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (typeof body.apiKey === "string" && body.apiKey.length > 0) {
      updateData.apiKeyEncrypted = encrypt(body.apiKey);
    }

    const bot = await prismaClient.bot.update({
      where: { id: botId },
      data: updateData,
      select: {
        id: true,
        name: true,
        llmProvider: true,
        llmModel: true,
        apiEndpoint: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        isActive: true,
        triggerMode: true,
      },
    });

    return NextResponse.json(bot);
  };
}

export function createServerChannelPatchHandler({
  getServerSession,
  authOptions,
  prismaClient,
}) {
  return async function serverChannelPatchHandler(request, { params }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { serverId, channelId } = await params;

    const server = await prismaClient.server.findUnique({
      where: { id: serverId },
    });
    if (!server || server.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Not the server owner" },
        { status: 403 },
      );
    }

    const existingChannel = await prismaClient.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (
      !existingChannel ||
      !canMutateServerScopedResource(serverId, existingChannel.serverId)
    ) {
      return NextResponse.json(
        { error: "Channel not found in this server" },
        { status: 404 },
      );
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }
      body = parsedBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updateData = {};

    if ("defaultBotId" in body) {
      if (body.defaultBotId === null) {
        updateData.defaultBotId = null;
      } else if (
        typeof body.defaultBotId !== "string" ||
        body.defaultBotId.length === 0
      ) {
        return NextResponse.json(
          { error: "defaultBotId must be a string or null" },
          { status: 400 },
        );
      } else {
        const bot = await prismaClient.bot.findUnique({
          where: { id: body.defaultBotId },
        });
        if (!bot || bot.serverId !== serverId) {
          return NextResponse.json(
            { error: "Bot not found in this server" },
            { status: 400 },
          );
        }
        updateData.defaultBotId = body.defaultBotId;
      }
    }

    if ("topic" in body) {
      if (body.topic === null || body.topic === "") {
        updateData.topic = null;
      } else if (typeof body.topic === "string") {
        updateData.topic = body.topic;
      } else {
        return NextResponse.json(
          { error: "topic must be a string or null" },
          { status: 400 },
        );
      }
    }

    // TASK-0012: Validate botIds array for multi-bot assignment
    if ("botIds" in body) {
      if (!Array.isArray(body.botIds)) {
        return NextResponse.json(
          { error: "botIds must be an array of strings" },
          { status: 400 },
        );
      }
      // Validate all items are non-empty strings
      for (const id of body.botIds) {
        if (typeof id !== "string" || id.length === 0) {
          return NextResponse.json(
            { error: "botIds must be an array of strings" },
            { status: 400 },
          );
        }
      }
      // Validate all bot IDs exist in the server
      if (body.botIds.length > 0 && prismaClient.bot?.findMany) {
        const validBots = await prismaClient.bot.findMany({
          where: { id: { in: body.botIds }, serverId },
          select: { id: true },
        });
        const validIds = new Set(validBots.map((b) => b.id));
        const invalid = body.botIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: `Bots not found in this server: ${invalid.join(", ")}` },
            { status: 400 },
          );
        }
      }
    }

    const channel = await prismaClient.channel.update({
      where: { id: channelId },
      data: updateData,
      select: {
        id: true,
        name: true,
        topic: true,
        defaultBotId: true,
      },
    });

    return NextResponse.json(channel);
  };
}

// ============================================================
// AGENT HANDLERS (DEC-0040)
// ============================================================

/**
 * Hash an API key with SHA-256 for indexed lookup.
 * Exported for testing.
 */
export function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * GET /api/v1/agents/{id}
 * Public agent info (no auth required).
 */
export function createAgentGetHandler({ prismaClient }) {
  return async function agentGetHandler(agentId) {
    const bot = await prismaClient.bot.findUnique({
      where: { id: agentId },
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
          },
        },
      },
    });

    if (!bot || !bot.agentRegistration) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
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
      createdAt: bot.createdAt,
    });
  };
}

/**
 * Authenticate an agent via Authorization: Bearer sk-tvk-...
 * Returns { authorized, error, status }.
 */
export async function authenticateAgentKey(authHeader, agentId, prismaClient) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authorized: false,
      error: "Missing Authorization header",
      status: 401,
    };
  }

  const apiKey = authHeader.slice(7);
  const apiKeyHash = hashApiKey(apiKey);

  const registration = await prismaClient.agentRegistration.findFirst({
    where: { apiKeyHash, botId: agentId },
    select: { id: true, botId: true },
  });

  if (!registration) {
    return { authorized: false, error: "Invalid API key", status: 401 };
  }

  return { authorized: true };
}

/**
 * PATCH /api/v1/agents/{id}
 * Update agent. Requires Bearer auth.
 */
export function createAgentPatchHandler({ prismaClient }) {
  return async function agentPatchHandler(request, agentId) {
    const authHeader = request.headers.get("authorization");
    const auth = await authenticateAgentKey(authHeader, agentId, prismaClient);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }
      body = parsedBody;
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
    } = body;

    try {
      await prismaClient.$transaction(async (tx) => {
        const botUpdate = {};
        if (displayName !== undefined) botUpdate.name = displayName;
        if (avatarUrl !== undefined) botUpdate.avatarUrl = avatarUrl;

        if (Object.keys(botUpdate).length > 0) {
          await tx.bot.update({ where: { id: agentId }, data: botUpdate });
        }

        const regUpdate = {};
        if (capabilities !== undefined) regUpdate.capabilities = capabilities;
        if (healthUrl !== undefined) regUpdate.healthUrl = healthUrl;
        if (webhookUrl !== undefined) regUpdate.webhookUrl = webhookUrl;
        if (maxTokensSec !== undefined) regUpdate.maxTokensSec = maxTokensSec;

        if (Object.keys(regUpdate).length > 0) {
          await tx.agentRegistration.update({
            where: { botId: agentId },
            data: regUpdate,
          });
        }
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Agent update failed:", error);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  };
}

/**
 * DELETE /api/v1/agents/{id}
 * Deregister agent. Cascade deletes Bot. Requires Bearer auth.
 */
export function createAgentDeleteHandler({ prismaClient }) {
  return async function agentDeleteHandler(request, agentId) {
    const authHeader = request.headers.get("authorization");
    const auth = await authenticateAgentKey(authHeader, agentId, prismaClient);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
      await prismaClient.bot.delete({ where: { id: agentId } });
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Agent deregistration failed:", error);
      return NextResponse.json(
        { error: "Deregistration failed" },
        { status: 500 },
      );
    }
  };
}

/**
 * GET /api/internal/agents/verify?api_key=sk-tvk-...
 * Called by Gateway to verify agent API key.
 * Requires X-Internal-Secret header.
 */
export function createAgentVerifyHandler({ prismaClient }) {
  return async function agentVerifyHandler(request) {
    const secret = request.headers.get("x-internal-secret");
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey =
      request.searchParams?.get("api_key") ||
      new URL(request.url).searchParams.get("api_key");

    if (!apiKey || !apiKey.startsWith("sk-tvk-")) {
      return NextResponse.json(
        { error: "Invalid API key format" },
        { status: 400 },
      );
    }

    const apiKeyHash = hashApiKey(apiKey);

    try {
      const registration = await prismaClient.agentRegistration.findFirst({
        where: { apiKeyHash },
        select: {
          id: true,
          capabilities: true,
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

      if (!registration) {
        return NextResponse.json(
          { error: "Agent not found", valid: false },
          { status: 404 },
        );
      }

      if (!registration.bot.isActive) {
        return NextResponse.json(
          { error: "Agent is deactivated", valid: false },
          { status: 403 },
        );
      }

      return NextResponse.json({
        valid: true,
        botId: registration.bot.id,
        botName: registration.bot.name,
        botAvatarUrl: registration.bot.avatarUrl,
        serverId: registration.bot.serverId,
        capabilities: registration.capabilities,
      });
    } catch (error) {
      console.error("Agent verification failed:", error);
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 500 },
      );
    }
  };
}
