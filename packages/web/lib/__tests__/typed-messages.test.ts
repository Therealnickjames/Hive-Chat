import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createInternalMessagesPostHandler } from "../route-handlers.js";

/**
 * Tests for TASK-0039: Typed Messages + Metadata
 *
 * Covers:
 * - New message types (TOOL_CALL, TOOL_RESULT, CODE_BLOCK, ARTIFACT, STATUS) accepted by POST handler
 * - Metadata field persisted when provided
 * - Metadata omitted when not provided
 * - Typed message content (JSON) persisted correctly
 */

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

function makePrismaClient(overrides: any = {}) {
  return {
    $transaction: async (cb: any) =>
      cb({
        message: {
          create: async ({ data }: any) => ({
            ...data,
            createdAt: new Date("2026-03-01"),
          }),
        },
        channel: {
          updateMany: async () => ({ count: 1 }),
        },
      }),
    agent: {
      findUnique: async () => ({
        name: "TestAgent",
        avatarUrl: "https://example.com/avatar.png",
      }),
    },
    user: { findUnique: async () => null },
    ...overrides,
  };
}

function makeTypedMessageBody(type: string, content: string, extras: any = {}) {
  return {
    id: `msg-${type.toLowerCase()}`,
    channelId: "c1",
    authorId: "agent-1",
    authorType: "AGENT",
    content,
    type,
    sequence: "10",
    ...extras,
  };
}

const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET;

describe("TASK-0039: Typed Message Types", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  const typedMessageTypes = [
    "TOOL_CALL",
    "TOOL_RESULT",
    "CODE_BLOCK",
    "ARTIFACT",
    "STATUS",
  ];

  for (const msgType of typedMessageTypes) {
    it(`accepts ${msgType} message type`, async () => {
      const handler = createInternalMessagesPostHandler({
        prismaClient: makePrismaClient(),
      });

      const content = JSON.stringify({ test: true, type: msgType });
      const res = await handler(
        makeRequest({
          body: makeTypedMessageBody(msgType, content),
        }),
      );

      expect(res.status).toBe(201);
      const payload = await res.json();
      expect(payload.type).toBe(msgType);
      expect(payload.content).toBe(content);
    });
  }

  it("still accepts STANDARD, STREAMING, SYSTEM types", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: makePrismaClient({
        agent: { findUnique: async () => null },
        user: {
          findUnique: async () => ({
            displayName: "Alice",
            avatarUrl: null,
          }),
        },
      }),
    });

    for (const msgType of ["STANDARD", "STREAMING", "SYSTEM"]) {
      const res = await handler(
        makeRequest({
          body: {
            id: `msg-${msgType}`,
            channelId: "c1",
            authorId: "u1",
            authorType: "USER",
            content: "hello",
            type: msgType,
            sequence: "1",
          },
        }),
      );
      expect(res.status).toBe(201);
    }
  });

  it("rejects invalid message type", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: makePrismaClient(),
    });

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody("INVALID_TYPE", "test"),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("TASK-0039: Metadata Persistence", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it("persists metadata when provided", async () => {
    let capturedCreateData: any = null;
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => {
                capturedCreateData = data;
                return { ...data, createdAt: new Date("2026-03-01") };
              },
            },
            channel: {
              updateMany: async () => ({ count: 1 }),
            },
          }),
        agent: {
          findUnique: async () => ({ name: "Agent", avatarUrl: null }),
        },
        user: { findUnique: async () => null },
      },
    });

    const metadata = {
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      tokensIn: 150,
      tokensOut: 843,
      latencyMs: 2300,
      costUsd: 0.0042,
    };

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "TOOL_CALL",
          JSON.stringify({
            callId: "test",
            toolName: "search",
            arguments: {},
            status: "completed",
          }),
          { metadata },
        ),
      }),
    );

    expect(res.status).toBe(201);
    expect(capturedCreateData).not.toBeNull();
    expect(capturedCreateData.metadata).toEqual(metadata);
  });

  it("does NOT include metadata when not provided", async () => {
    let capturedCreateData: any = null;
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => {
                capturedCreateData = data;
                return { ...data, createdAt: new Date("2026-03-01") };
              },
            },
            channel: {
              updateMany: async () => ({ count: 1 }),
            },
          }),
        agent: {
          findUnique: async () => ({ name: "Agent", avatarUrl: null }),
        },
        user: { findUnique: async () => null },
      },
    });

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "CODE_BLOCK",
          JSON.stringify({ language: "python", code: "print(1)" }),
        ),
      }),
    );

    expect(res.status).toBe(201);
    expect(capturedCreateData).not.toBeNull();
    expect(capturedCreateData).not.toHaveProperty("metadata");
  });

  it("does NOT include metadata when explicitly null", async () => {
    let capturedCreateData: any = null;
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => {
                capturedCreateData = data;
                return { ...data, createdAt: new Date("2026-03-01") };
              },
            },
            channel: {
              updateMany: async () => ({ count: 1 }),
            },
          }),
        agent: {
          findUnique: async () => ({ name: "Agent", avatarUrl: null }),
        },
        user: { findUnique: async () => null },
      },
    });

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "STATUS",
          JSON.stringify({ state: "thinking", detail: "" }),
          { metadata: null },
        ),
      }),
    );

    expect(res.status).toBe(201);
    expect(capturedCreateData).not.toBeNull();
    expect(capturedCreateData).not.toHaveProperty("metadata");
  });

  it("persists partial metadata (only model)", async () => {
    let capturedCreateData: any = null;
    const handler = createInternalMessagesPostHandler({
      prismaClient: {
        $transaction: async (cb: any) =>
          cb({
            message: {
              create: async ({ data }: any) => {
                capturedCreateData = data;
                return { ...data, createdAt: new Date("2026-03-01") };
              },
            },
            channel: {
              updateMany: async () => ({ count: 1 }),
            },
          }),
        agent: {
          findUnique: async () => ({ name: "Agent", avatarUrl: null }),
        },
        user: { findUnique: async () => null },
      },
    });

    const metadata = { model: "gpt-4o" };

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "ARTIFACT",
          JSON.stringify({
            artifactType: "html",
            title: "Preview",
            content: "<div/>",
          }),
          { metadata },
        ),
      }),
    );

    expect(res.status).toBe(201);
    expect(capturedCreateData.metadata).toEqual({ model: "gpt-4o" });
  });
});

describe("TASK-0039: AGENT authorType for typed messages", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it("returns AGENT authorName for typed messages with AGENT authorType", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: makePrismaClient(),
    });

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "TOOL_CALL",
          JSON.stringify({
            callId: "test",
            toolName: "search",
            arguments: {},
            status: "running",
          }),
        ),
      }),
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.authorName).toBe("TestAgent");
    expect(payload.authorAvatarUrl).toBe("https://example.com/avatar.png");
    expect(payload.authorType).toBe("AGENT");
  });

  it("returns empty reactions array for typed messages", async () => {
    const handler = createInternalMessagesPostHandler({
      prismaClient: makePrismaClient(),
    });

    const res = await handler(
      makeRequest({
        body: makeTypedMessageBody(
          "CODE_BLOCK",
          JSON.stringify({ language: "js", code: "console.log(1)" }),
        ),
      }),
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.reactions).toEqual([]);
  });
});
