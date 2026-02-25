import assert from "node:assert/strict";
import test from "node:test";

import {
  createInternalMessagesPostHandler,
  createServerBotPatchHandler,
  createServerChannelPatchHandler,
} from "./route-handlers.js";

function makeRequest({ secret = "test-secret", body, throwOnJson = false } = {}) {
  return {
    headers: new Headers({ "x-internal-secret": secret }),
    json: async () => {
      if (throwOnJson) {
        throw new Error("bad json");
      }
      return body;
    },
  };
}

test("internal POST returns 400 for invalid JSON body", async () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-secret";

  const handler = createInternalMessagesPostHandler({
    prismaClient: {},
  });

  const response = await handler(makeRequest({ body: null }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Invalid JSON body");

  process.env.INTERNAL_API_SECRET = originalSecret;
});

test("internal POST returns 400 for invalid sequence", async () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-secret";

  const handler = createInternalMessagesPostHandler({
    prismaClient: {},
  });

  const response = await handler(
    makeRequest({
      body: {
        id: "m1",
        channelId: "c1",
        authorId: "u1",
        authorType: "USER",
        content: "hello",
        type: "STANDARD",
        streamingStatus: null,
        sequence: "not-a-number",
      },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "sequence must be a non-negative integer string");

  process.env.INTERNAL_API_SECRET = originalSecret;
});

test("internal POST uses monotonic channel lastSequence update guard", async () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-secret";

  let updateManyArgs = null;
  const sequence = "9007199254740993";

  const handler = createInternalMessagesPostHandler({
    prismaClient: {
      $transaction: async (callback) =>
        callback({
          message: {
            create: async ({ data }) => ({
              id: data.id,
              channelId: data.channelId,
              authorId: data.authorId,
              authorType: data.authorType,
              content: data.content,
              type: data.type,
              streamingStatus: data.streamingStatus,
              sequence: data.sequence,
              createdAt: new Date("2026-02-25T00:00:00.000Z"),
            }),
          },
          channel: {
            updateMany: async (args) => {
              updateManyArgs = args;
              return { count: 1 };
            },
          },
        }),
      user: {
        findUnique: async () => ({ displayName: "Alice", avatarUrl: null }),
      },
      bot: {
        findUnique: async () => null,
      },
    },
  });

  const response = await handler(
    makeRequest({
      body: {
        id: "m1",
        channelId: "c1",
        authorId: "u1",
        authorType: "USER",
        content: "hello",
        type: "STANDARD",
        streamingStatus: null,
        sequence,
      },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.sequence, sequence);
  assert.deepEqual(updateManyArgs, {
    where: {
      id: "c1",
      lastSequence: { lt: BigInt(sequence) },
    },
    data: { lastSequence: BigInt(sequence) },
  });

  process.env.INTERNAL_API_SECRET = originalSecret;
});

test("bot PATCH returns 400 for invalid JSON body", async () => {
  const handler = createServerBotPatchHandler({
    getServerSession: async () => ({ user: { id: "owner-1" } }),
    authOptions: {},
    prismaClient: {
      server: {
        findUnique: async () => ({ ownerId: "owner-1" }),
      },
      bot: {
        findUnique: async () => ({ serverId: "s1" }),
        update: async () => {
          throw new Error("should not update");
        },
      },
    },
    encrypt: (value) => `enc:${value}`,
  });

  const response = await handler(
    {
      json: async () => null,
    },
    { params: Promise.resolve({ serverId: "s1", botId: "b1" }) }
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Invalid JSON body");
});

test("channel PATCH returns 400 for invalid JSON body", async () => {
  const handler = createServerChannelPatchHandler({
    getServerSession: async () => ({ user: { id: "owner-1" } }),
    authOptions: {},
    prismaClient: {
      server: {
        findUnique: async () => ({ ownerId: "owner-1" }),
      },
      channel: {
        findUnique: async () => ({ serverId: "s1" }),
        update: async () => {
          throw new Error("should not update");
        },
      },
      bot: {
        findUnique: async () => null,
      },
    },
  });

  const response = await handler(
    {
      json: async () => null,
    },
    { params: Promise.resolve({ serverId: "s1", channelId: "c1" }) }
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Invalid JSON body");
});
