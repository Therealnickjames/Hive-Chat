import { NextRequest, NextResponse } from "next/server";
import {
  buildMonotonicLastSequenceUpdate,
  canMutateServerScopedResource,
  isJsonObjectBody,
  parseNonNegativeSequence,
  serializeSequence,
} from "./api-safety";
import { parseMentionedUserIds } from "./mention-parser";
import { generateId } from "./ulid";
import { validateInternalSecretValue } from "./internal-auth";
import type { PrismaClient } from "@prisma/client";

// ---------- Shared types ----------

type AuthorType = "USER" | "AGENT" | "SYSTEM";
type MessageType =
  | "STANDARD"
  | "STREAMING"
  | "SYSTEM"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "CODE_BLOCK"
  | "ARTIFACT"
  | "STATUS";
type StreamingStatus = "ACTIVE" | "COMPLETE" | "ERROR";

// Minimal request shape — tests pass plain objects, not full NextRequest
interface RequestLike {
  headers: Headers;
  url: string;
  json: () => Promise<unknown>;
  searchParams?: URLSearchParams;
}

// Next.js App Router context for route handlers with dynamic params
interface RouteContext {
  params: Promise<Record<string, string>>;
}

// ---------- Type guards ----------

function isAuthorType(value: unknown): value is AuthorType {
  return value === "USER" || value === "AGENT" || value === "SYSTEM";
}

function isMessageType(value: unknown): value is MessageType {
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

function isStreamingStatus(value: unknown): value is StreamingStatus {
  return value === "ACTIVE" || value === "COMPLETE" || value === "ERROR";
}

// ---------- Helpers ----------

function extractAttachmentIds(content: string): string[] {
  const ids: string[] = [];
  const regex = /\[file:([^:\]]+):[^:\]]+:[^\]]+\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

// ---------- Handler factories ----------

interface PrismaClientDep {
  prismaClient: PrismaClient;
}

interface SessionDeps {
  getServerSession: (
    authOptions: unknown,
  ) => Promise<{ user?: { id?: string } } | null>;
  authOptions: unknown;
  prismaClient: PrismaClient;
}

interface ServerAgentPatchDeps extends SessionDeps {
  encrypt: (value: string) => string;
}

export function createInternalMessagesPostHandler({
  prismaClient,
}: PrismaClientDep) {
  return async function internalMessagesPostHandler(request: NextRequest) {
    const secret = request.headers.get("x-internal-secret");
    if (!validateInternalSecretValue(secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
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

    const sequenceBigInt = parseNonNegativeSequence(
      sequenceValue as string | number | bigint,
    );
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
      const createData: Record<string, unknown> = {
        id,
        channelId,
        authorId,
        authorType,
        content,
        type,
        streamingStatus: (streamingStatus as string) ?? null,
        sequence: sequenceBigInt,
      };
      if (metadata !== undefined && metadata !== null) {
        createData.metadata = metadata;
      }

      const [message] = await prismaClient.$transaction(async (tx) => {
        const createdMessage = await tx.message.create({
          data: createData as Parameters<typeof tx.message.create>[0]["data"],
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
          // Fetch server members and agents via the channel's serverId
          const channel = await prismaClient.channel.findUnique({
            where: { id: channelId },
            select: { serverId: true },
          });

          if (channel) {
            const [serverMembers, serverAgents] = await Promise.all([
              prismaClient.member.findMany({
                where: { serverId: channel.serverId },
                select: {
                  userId: true,
                  user: { select: { displayName: true } },
                },
              }),
              prismaClient.agent.findMany({
                where: { serverId: channel.serverId, isActive: true },
                select: { id: true, name: true },
              }),
            ]);

            const memberTargets = serverMembers.map((m) => ({
              id: m.userId,
              name: m.user.displayName,
            }));
            const agentTargets = serverAgents.map((a) => ({
              id: a.id,
              name: a.name,
            }));

            const mentionedIds = parseMentionedUserIds(
              content,
              memberTargets,
              agentTargets,
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

      // BUG-002: Use descriptive fallback instead of "Unknown" for deleted authors
      let authorName =
        authorType === "AGENT" ? "Deleted Agent" : "Deleted User";
      let authorAvatarUrl: string | null = null;

      if (authorType === "USER") {
        const user = await prismaClient.user.findUnique({
          where: { id: authorId },
          select: { displayName: true, avatarUrl: true },
        });
        if (user) {
          authorName = user.displayName;
          authorAvatarUrl = user.avatarUrl;
        }
      } else if (authorType === "AGENT") {
        const agent = await prismaClient.agent.findUnique({
          where: { id: authorId },
          select: { name: true, avatarUrl: true },
        });
        if (agent) {
          authorName = agent.name;
          authorAvatarUrl = agent.avatarUrl;
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
    } catch (error: unknown) {
      // P2002 = Prisma unique constraint violation (duplicate message ID).
      // Return 409 so Gateway retry logic treats it as success (idempotency).
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return NextResponse.json(
          { error: "Message already exists" },
          { status: 409 },
        );
      }
      console.error("[route-handlers] Failed to persist message:", error);
      return NextResponse.json(
        { error: "Failed to persist message" },
        { status: 500 },
      );
    }
  };
}

export function createServerAgentPatchHandler({
  getServerSession,
  authOptions,
  prismaClient,
  encrypt,
}: ServerAgentPatchDeps) {
  return async function serverAgentPatchHandler(
    request: RequestLike,
    { params }: RouteContext,
  ) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { serverId, agentId } = await params;

    const server = await prismaClient.server.findUnique({
      where: { id: serverId },
    });
    if (!server || server.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Not the server owner" },
        { status: 403 },
      );
    }

    const existingAgent = await prismaClient.agent.findUnique({
      where: { id: agentId },
      select: { serverId: true },
    });
    if (
      !existingAgent ||
      !canMutateServerScopedResource(serverId, existingAgent.serverId)
    ) {
      return NextResponse.json(
        { error: "Agent not found in this server" },
        { status: 404 },
      );
    }

    let body: Record<string, unknown>;
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

    const updateData: Record<string, unknown> = {};
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

    if (typeof body.apiKey === "string" && (body.apiKey as string).length > 0) {
      updateData.apiKeyEncrypted = encrypt(body.apiKey as string);
    }

    const agent = await prismaClient.agent.update({
      where: { id: agentId },
      data: updateData as Parameters<
        typeof prismaClient.agent.update
      >[0]["data"],
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

    return NextResponse.json(agent);
  };
}

export function createServerChannelPatchHandler({
  getServerSession,
  authOptions,
  prismaClient,
}: SessionDeps) {
  return async function serverChannelPatchHandler(
    request: RequestLike,
    { params }: RouteContext,
  ) {
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

    let body: Record<string, unknown>;
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

    const updateData: Record<string, unknown> = {};

    if ("defaultAgentId" in body) {
      if (body.defaultAgentId === null) {
        updateData.defaultAgentId = null;
      } else if (
        typeof body.defaultAgentId !== "string" ||
        (body.defaultAgentId as string).length === 0
      ) {
        return NextResponse.json(
          { error: "defaultAgentId must be a string or null" },
          { status: 400 },
        );
      } else {
        const agent = await prismaClient.agent.findUnique({
          where: { id: body.defaultAgentId as string },
        });
        if (!agent || agent.serverId !== serverId) {
          return NextResponse.json(
            { error: "Agent not found in this server" },
            { status: 400 },
          );
        }
        updateData.defaultAgentId = body.defaultAgentId;
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

    // TASK-0012: Validate agentIds array for multi-agent assignment
    if ("agentIds" in body) {
      if (!Array.isArray(body.agentIds)) {
        return NextResponse.json(
          { error: "agentIds must be an array of strings" },
          { status: 400 },
        );
      }
      // Validate all items are non-empty strings
      for (const id of body.agentIds as unknown[]) {
        if (typeof id !== "string" || id.length === 0) {
          return NextResponse.json(
            { error: "agentIds must be an array of strings" },
            { status: 400 },
          );
        }
      }
      // Validate all agent IDs exist in the server
      const agentIds = body.agentIds as string[];
      if (agentIds.length > 0) {
        const validAgents = await prismaClient.agent.findMany({
          where: { id: { in: agentIds }, serverId },
          select: { id: true },
        });
        const validIds = new Set(validAgents.map((a) => a.id));
        const invalid = agentIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
          return NextResponse.json(
            {
              error: `Agents not found in this server: ${invalid.join(", ")}`,
            },
            { status: 400 },
          );
        }
      }
    }

    const channel = await prismaClient.channel.update({
      where: { id: channelId },
      data: updateData as Parameters<
        typeof prismaClient.channel.update
      >[0]["data"],
      select: {
        id: true,
        name: true,
        topic: true,
        defaultAgentId: true,
      },
    });

    return NextResponse.json(channel);
  };
}

// ============================================================
// AGENT HANDLERS (DEC-0040)
// ============================================================
