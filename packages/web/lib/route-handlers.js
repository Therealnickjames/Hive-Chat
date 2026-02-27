import { NextResponse } from "next/server.js";
import {
  buildMonotonicLastSequenceUpdate,
  canMutateServerScopedResource,
  isJsonObjectBody,
  parseNonNegativeSequence,
  serializeSequence,
} from "./api-safety.js";

function isAuthorType(value) {
  return value === "USER" || value === "BOT" || value === "SYSTEM";
}

function isMessageType(value) {
  return value === "STANDARD" || value === "STREAMING" || value === "SYSTEM";
}

function isStreamingStatus(value) {
  return value === "ACTIVE" || value === "COMPLETE" || value === "ERROR";
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
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
        { status: 400 }
      );
    }

    const sequenceBigInt = parseNonNegativeSequence(sequenceValue);
    if (sequenceBigInt === null) {
      return NextResponse.json(
        { error: "sequence must be a non-negative integer string" },
        { status: 400 }
      );
    }

    try {
      const [message] = await prismaClient.$transaction(async (tx) => {
        const createdMessage = await tx.message.create({
          data: {
            id,
            channelId,
            authorId,
            authorType,
            content,
            type,
            streamingStatus: streamingStatus ?? null,
            sequence: sequenceBigInt,
          },
        });

        await tx.channel.updateMany({
          ...buildMonotonicLastSequenceUpdate(channelId, sequenceBigInt),
        });

        return [createdMessage];
      });

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
        },
        { status: 201 }
      );
    } catch (error) {
      console.error("Failed to persist message:", error);
      return NextResponse.json(
        { error: "Failed to persist message" },
        { status: 500 }
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

    const server = await prismaClient.server.findUnique({ where: { id: serverId } });
    if (!server || server.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
    }

    const existingBot = await prismaClient.bot.findUnique({
      where: { id: botId },
      select: { serverId: true },
    });
    if (
      !existingBot ||
      !canMutateServerScopedResource(serverId, existingBot.serverId)
    ) {
      return NextResponse.json({ error: "Bot not found in this server" }, { status: 404 });
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

    const server = await prismaClient.server.findUnique({ where: { id: serverId } });
    if (!server || server.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Not the server owner" }, { status: 403 });
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
        { status: 404 }
      );
    }

    let body;
    try {
      const parsedBody = await request.json();
      if (!isJsonObjectBody(parsedBody)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
          { status: 400 }
        );
      } else {
        const bot = await prismaClient.bot.findUnique({
          where: { id: body.defaultBotId },
        });
        if (!bot || bot.serverId !== serverId) {
          return NextResponse.json(
            { error: "Bot not found in this server" },
            { status: 400 }
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
          { status: 400 }
        );
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
