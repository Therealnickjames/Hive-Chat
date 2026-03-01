import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createInternalMessagesPostHandler,
  createServerBotPatchHandler,
  createServerChannelPatchHandler,
} from "../route-handlers.js";

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
      })
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
      })
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
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "sequence must be a non-negative integer string"
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
      })
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
      })
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
      })
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
        })
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
      })
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
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
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
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
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
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for null JSON body", async () => {
    const handler = await makeBotHandler();
    const res = await handler(
      { json: async () => null },
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
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
      { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
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
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) }
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
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) }
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
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) }
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
      { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) }
    );
    expect(res.status).toBe(200);
    expect(capturedUpdate.defaultBotId).toBeNull();
  });
});
