import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createInternalMessagesPostHandler,
  createServerBotPatchHandler,
  createServerChannelPatchHandler,
} from "../route-handlers.js";

// ---------- Mocks for the PUT finalization handler (TASK-0021) ----------
// vi.hoisted ensures these are available when vi.mock factories run.
// The factory-based imports from route-handlers.js use dependency injection,
// so they are not affected by these module-level mocks.

const { mockPrismaForRoute } = vi.hoisted(() => {
  return {
    mockPrismaForRoute: {
      message: {
        update: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrismaForRoute }));
vi.mock("@/lib/internal-auth", () => ({
  validateInternalSecret: vi.fn((req: any) => {
    return req.headers.get("x-internal-secret") === "test-secret";
  }),
}));
vi.mock("@/lib/permissions", () => ({
  computeMemberPermissions: vi.fn(),
  hasPermission: vi.fn(),
  Permissions: { MANAGE_MESSAGES: 1 },
}));

function makeRequest({
  secret = "test-secret",
  body = undefined as any,
  throwOnJson = false,
} = {}) {
  return {
    headers: new Headers({ "x-internal-secret": secret }),
    json: async () => {
      if (throwOnJson) throw new Error("bad json");
      return body;
    },
  };
}

const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET;

describe("createInternalMessagesPostHandler", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
  });

  it("returns 401 for wrong internal secret", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(makeRequest({ secret: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for null JSON body", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(makeRequest({ body: null }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 400 for array JSON body", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(makeRequest({ body: [1, 2, 3] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when json() throws", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(makeRequest({ throwOnJson: true }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(makeRequest({ body: { id: "m1" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  it("returns 400 for invalid authorType", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "INVALID",
          content: "test",
          type: "STANDARD",
          sequence: "1",
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid message type", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "test",
          type: "UNKNOWN",
          sequence: "1",
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric sequence", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "hello",
          type: "STANDARD",
          sequence: "not-a-number",
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "sequence must be a non-negative integer string",
    );
  });

  it("returns 201 for valid message and uses monotonic sequence guard", async () => {
    let capturedChannelUpdate: any = null;
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => ({
                ...data,
                createdAt: new Date("2026-01-01"),
              }),
            },
            channel: {
              updateMany: async (args: any) => {
                capturedChannelUpdate = args;
                return { count: 1 };
              },
            },
          }),
        user: {
          findUnique: async () => ({
            displayName: "Alice",
            avatarUrl: null,
          }),
        },
        bot: { findUnique: async () => null },
      },
    });

    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "hello world",
          type: "STANDARD",
          sequence: "42",
        },
      }),
    );
    expect(res.status).toBe(201);

    const payload = await res.json();
    expect(payload.id).toBe("m1");
    expect(payload.authorName).toBe("Alice");
    expect(payload.sequence).toBe("42");
    expect(payload.reactions).toEqual([]);

    // Verify monotonic guard
    expect(capturedChannelUpdate.where.lastSequence.lt).toBe(BigInt(42));
  });

  it("returns 409 for duplicate message ID (P2002)", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async () => {
          const err: any = new Error("Unique constraint");
          err.code = "P2002";
          throw err;
        },
      },
    });

    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "hello",
          type: "STANDARD",
          sequence: "1",
        },
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Message already exists");
  });

  it("returns 500 for unexpected database errors", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async () => {
          throw new Error("Connection lost");
        },
      },
    });

    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "hello",
          type: "STANDARD",
          sequence: "1",
        },
      }),
    );
    expect(res.status).toBe(500);
  });

  it("accepts valid streamingStatus values", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => ({
                ...data,
                createdAt: new Date(),
              }),
            },
            channel: { updateMany: async () => ({ count: 1 }) },
          }),
        bot: {
          findUnique: async () => ({ name: "TestBot", avatarUrl: null }),
        },
        user: { findUnique: async () => null },
      },
    });

    for (const status of ["ACTIVE", "COMPLETE", "ERROR"]) {
      const res = await handler(
        makeRequest({
          body: {
            id: `m-${status}`,
            channelId: "c1",
            authorId: "b1",
            authorType: "BOT",
            content: "",
            type: "STREAMING",
            streamingStatus: status,
            sequence: "1",
          },
        }),
      );
      expect(res.status).toBe(201);
    }
  });

  it("rejects invalid streamingStatus", async () => {
    const handler = createInternalMessagesPostHandler({ prismaClient: {} });
    const res = await handler(
      makeRequest({
        body: {
          id: "m1",
          channelId: "c1",
          authorId: "u1",
          authorType: "USER",
          content: "hello",
          type: "STANDARD",
          streamingStatus: "INVALID_STATUS",
          sequence: "1",
        },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("createServerBotPatchHandler", () => {
  const makeBotHandler = (overrides = {}) =>
    createServerBotPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        bot: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async ({ data }: any) => ({
            id: "b1",
            name: data.name ?? "TestBot",
            ...data,
          }),
        },
      },
      encrypt: (v: string) => `enc:${v}`,
      ...overrides,
    });

  it("returns 401 when not authenticated", async () => {
    const handler = createServerBotPatchHandler({
      getServerSession: async () => null,
      authOptions: {},
      prismaClient: {},
      encrypt: (v: string) => v,
    });
    const res = await handler(
      { json: async () => ({}) },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not server owner", async () => {
    const handler = createServerBotPatchHandler({
      getServerSession: async () => ({ user: { id: "not-owner" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
      },
      encrypt: (v: string) => v,
    });
    const res = await handler(
      { json: async () => ({}) },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when bot is not in the server (IDOR prevention)", async () => {
    const handler = createServerBotPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        bot: { findUnique: async () => ({ serverId: "different-server" }) },
      },
      encrypt: (v: string) => v,
    });
    const res = await handler(
      { json: async () => ({}) },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for null JSON body", async () => {
    const handler = await makeBotHandler();
    const res = await handler(
      { json: async () => null },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("encrypts apiKey when provided", async () => {
    let capturedUpdate: any = null;
    const handler = createServerBotPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        bot: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async ({ data }: any) => {
            capturedUpdate = data;
            return { id: "b1", ...data };
          },
        },
      },
      encrypt: (v: string) => `encrypted:${v}`,
    });

    await handler(
      { json: async () => ({ apiKey: "sk-secret-key" }) },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) },
    );

    expect(capturedUpdate.apiKeyEncrypted).toBe("encrypted:sk-secret-key");
  });
});

describe("createServerChannelPatchHandler", () => {
  it("returns 401 when not authenticated", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => null,
      authOptions: {},
      prismaClient: {},
    });
    const res = await handler(
      { json: async () => ({}) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when channel is not in the server (IDOR prevention)", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: {
          findUnique: async () => ({ serverId: "different-server" }),
        },
      },
    });
    const res = await handler(
      { json: async () => ({}) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid defaultBotId type", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: { findUnique: async () => ({ serverId: "s1" }) },
      },
    });
    const res = await handler(
      { json: async () => ({ defaultBotId: 123 }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("allows setting defaultBotId to null", async () => {
    let capturedUpdate: any = null;
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async ({ data }: any) => {
            capturedUpdate = data;
            return { id: "c1", name: "general", ...data };
          },
        },
      },
    });
    const res = await handler(
      { json: async () => ({ defaultBotId: null }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect(capturedUpdate.defaultBotId).toBeNull();
  });

  // --- TASK-0012: Multi-bot channel assignment tests ---

  it("returns 400 when botIds is not an array", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: { findUnique: async () => ({ serverId: "s1" }) },
      },
    });
    const res = await handler(
      { json: async () => ({ botIds: "not-an-array" }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("botIds must be an array of strings");
  });

  it("returns 400 when botIds contains non-string elements", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: { findUnique: async () => ({ serverId: "s1" }) },
      },
    });
    const res = await handler(
      { json: async () => ({ botIds: ["bot-1", 123, "bot-3"] }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("botIds must be an array of strings");
  });

  it("returns 400 when botIds contains bots not in server", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async ({ data }: any) => ({
            id: "c1",
            name: "general",
            ...data,
          }),
        },
        bot: {
          findMany: async () => [{ id: "bot-1" }], // Only bot-1 exists
        },
      },
    });
    const res = await handler(
      { json: async () => ({ botIds: ["bot-1", "bot-nonexistent"] }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("bot-nonexistent");
  });

  it("accepts valid botIds array and proceeds to update", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async () => ({
            id: "c1",
            name: "general",
            topic: null,
            defaultBotId: "bot-1",
          }),
        },
        bot: {
          findMany: async () => [{ id: "bot-1" }, { id: "bot-2" }],
        },
      },
    });
    const res = await handler(
      { json: async () => ({ botIds: ["bot-1", "bot-2"] }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(200);
  });

  it("accepts empty botIds array (remove all bots)", async () => {
    const handler = createServerChannelPatchHandler({
      getServerSession: async () => ({ user: { id: "owner-1" } }),
      authOptions: {},
      prismaClient: {
        server: { findUnique: async () => ({ ownerId: "owner-1" }) },
        channel: {
          findUnique: async () => ({ serverId: "s1" }),
          update: async () => ({
            id: "c1",
            name: "general",
            topic: null,
            defaultBotId: null,
          }),
        },
      },
    });
    const res = await handler(
      { json: async () => ({ botIds: [] }) },
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) },
    );
    expect(res.status).toBe(200);
  });
});

// ===========================================================
// PUT /api/internal/messages/{messageId} — finalization handler
// Tests for tokenHistory, checkpoints, and general finalization
// (TASK-0021: Stream rewind & checkpoint resume)
// ===========================================================

// Lazy-import the PUT handler after vi.mock calls have taken effect
let PUT: any;

describe("PUT /api/internal/messages/{messageId} — finalization", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import so vi.mock for @/lib/db and @/lib/internal-auth apply
    const mod = await import("@/app/api/internal/messages/[messageId]/route");
    PUT = mod.PUT;

    mockPrismaForRoute.message.update.mockResolvedValue({
      id: "msg-1",
      content: "final content",
      streamingStatus: "COMPLETE",
    });
  });

  function makePutRequest({ secret = "test-secret", body = {} as any } = {}) {
    return new Request("http://localhost/api/internal/messages/msg-1", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify(body),
    }) as any;
  }

  const routeCtx = {
    params: Promise.resolve({ messageId: "msg-1" }),
  };

  it("returns 401 for wrong internal secret", async () => {
    const res = await PUT(makePutRequest({ secret: "wrong" }), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither content nor streamingStatus is provided", async () => {
    const res = await PUT(makePutRequest({ body: {} }), routeCtx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Must provide content or streamingStatus");
  });

  it("persists tokenHistory when included in the finalize payload", async () => {
    const tokenHistory = [
      { t: 0, tokens: 50 },
      { t: 1000, tokens: 150 },
      { t: 2000, tokens: 300 },
    ];

    const res = await PUT(
      makePutRequest({
        body: {
          content: "final answer",
          streamingStatus: "COMPLETE",
          tokenHistory,
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    // Verify prisma.message.update was called with tokenHistory
    expect(mockPrismaForRoute.message.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe("msg-1");
    expect(updateArgs.data.tokenHistory).toEqual(tokenHistory);
  });

  it("persists checkpoints when included in the finalize payload", async () => {
    const checkpoints = [
      { offset: 0, label: "start" },
      { offset: 500, label: "midpoint" },
    ];

    const res = await PUT(
      makePutRequest({
        body: {
          content: "completed response",
          streamingStatus: "COMPLETE",
          checkpoints,
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.checkpoints).toEqual(checkpoints);
  });

  it("persists both tokenHistory and checkpoints together", async () => {
    const tokenHistory = [{ t: 0, tokens: 100 }];
    const checkpoints = [{ offset: 0, label: "start" }];

    const res = await PUT(
      makePutRequest({
        body: {
          content: "done",
          streamingStatus: "COMPLETE",
          tokenHistory,
          checkpoints,
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.tokenHistory).toEqual(tokenHistory);
    expect(updateArgs.data.checkpoints).toEqual(checkpoints);
  });

  it("omits tokenHistory from update when not provided", async () => {
    const res = await PUT(
      makePutRequest({
        body: {
          content: "no rewind data",
          streamingStatus: "COMPLETE",
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("tokenHistory");
    expect(updateArgs.data).not.toHaveProperty("checkpoints");
  });

  it("accepts content update without streamingStatus", async () => {
    const res = await PUT(
      makePutRequest({ body: { content: "updated text" } }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.content).toBe("updated text");
  });

  it("accepts streamingStatus update without content", async () => {
    const res = await PUT(
      makePutRequest({ body: { streamingStatus: "ERROR" } }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.streamingStatus).toBe("ERROR");
  });

  it("persists thinkingTimeline when included", async () => {
    const thinkingTimeline = [
      { phase: "thinking", startMs: 0, endMs: 500 },
      { phase: "writing", startMs: 500, endMs: 2000 },
    ];

    const res = await PUT(
      makePutRequest({
        body: {
          content: "response",
          streamingStatus: "COMPLETE",
          thinkingTimeline,
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.thinkingTimeline).toEqual(thinkingTimeline);
  });

  it("persists metadata when included", async () => {
    const metadata = { model: "gpt-4", tokensUsed: 512 };

    const res = await PUT(
      makePutRequest({
        body: {
          content: "response",
          streamingStatus: "COMPLETE",
          metadata,
        },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.metadata).toEqual(metadata);
  });

  it("returns 500 when prisma update throws", async () => {
    mockPrismaForRoute.message.update.mockRejectedValue(
      new Error("Connection lost"),
    );

    const res = await PUT(
      makePutRequest({
        body: { content: "text", streamingStatus: "COMPLETE" },
      }),
      routeCtx,
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Failed to update message");
  });

  it("allows empty string content with streamingStatus", async () => {
    const res = await PUT(
      makePutRequest({
        body: { content: "", streamingStatus: "ERROR" },
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const updateArgs = mockPrismaForRoute.message.update.mock.calls[0][0];
    expect(updateArgs.data.content).toBe("");
    expect(updateArgs.data.streamingStatus).toBe("ERROR");
  });
});
