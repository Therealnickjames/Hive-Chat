import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAgentGetHandler,
  createAgentPatchHandler,
  createAgentDeleteHandler,
  createAgentVerifyHandler,
  hashApiKey,
  authenticateAgentKey,
} from "../route-handlers.js";

// ---- Test Helpers ----

const TEST_API_KEY = "sk-tvk-test-key-abc123";
const TEST_API_KEY_HASH = hashApiKey(TEST_API_KEY);

function makeAgentRequest({
  body = undefined as any,
  throwOnJson = false,
  authHeader = undefined as string | undefined,
  secret = undefined as string | undefined,
  url = "http://localhost:5555/api/v1/agents/test",
} = {}) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  if (secret !== undefined) headers.set("x-internal-secret", secret);

  return {
    headers,
    url,
    json: async () => {
      if (throwOnJson) throw new Error("bad json");
      return body;
    },
  };
}

const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET;

// ---- hashApiKey ----

describe("hashApiKey", () => {
  it("returns a 64-char hex string", () => {
    const hash = hashApiKey("sk-tvk-test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces deterministic output", () => {
    expect(hashApiKey("sk-tvk-abc")).toBe(hashApiKey("sk-tvk-abc"));
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("sk-tvk-aaa")).not.toBe(hashApiKey("sk-tvk-bbb"));
  });
});

// ---- authenticateAgentKey ----

describe("authenticateAgentKey", () => {
  it("returns unauthorized for missing header", async () => {
    const result = await authenticateAgentKey(null, "agent-1", {});
    expect(result.authorized).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns unauthorized for non-Bearer header", async () => {
    const result = await authenticateAgentKey("Basic abc", "agent-1", {});
    expect(result.authorized).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns unauthorized when key hash doesn't match", async () => {
    const mockPrisma = {
      agentRegistration: {
        findFirst: async () => null,
      },
    };
    const result = await authenticateAgentKey(
      `Bearer ${TEST_API_KEY}`,
      "agent-1",
      mockPrisma,
    );
    expect(result.authorized).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("returns authorized when key hash matches", async () => {
    const mockPrisma = {
      agentRegistration: {
        findFirst: async ({ where }: any) => {
          if (
            where.apiKeyHash === TEST_API_KEY_HASH &&
            where.agentId === "agent-1"
          ) {
            return { id: "reg-1", agentId: "agent-1" };
          }
          return null;
        },
      },
    };
    const result = await authenticateAgentKey(
      `Bearer ${TEST_API_KEY}`,
      "agent-1",
      mockPrisma,
    );
    expect(result.authorized).toBe(true);
  });

  it("rejects key valid for different agent", async () => {
    const mockPrisma = {
      agentRegistration: {
        findFirst: async ({ where }: any) => {
          // Key matches but agentId doesn't
          if (where.agentId === "agent-1") return null;
          return { id: "reg-1", agentId: "agent-2" };
        },
      },
    };
    const result = await authenticateAgentKey(
      `Bearer ${TEST_API_KEY}`,
      "agent-1",
      mockPrisma,
    );
    expect(result.authorized).toBe(false);
  });
});

// ---- createAgentGetHandler ----

describe("createAgentGetHandler", () => {
  it("returns 200 with agent info for valid registered agent", async () => {
    const handler = createAgentGetHandler({
      prismaClient: {
        agent: {
          findUnique: async () => ({
            id: "b1",
            name: "Test Agent",
            avatarUrl: null,
            serverId: "s1",
            llmModel: "custom",
            isActive: true,
            triggerMode: "MENTION",
            createdAt: new Date("2026-03-01"),
            agentRegistration: {
              capabilities: ["text"],
              healthUrl: null,
              webhookUrl: null,
              maxTokensSec: 100,
              lastHealthCheck: null,
              lastHealthOk: true,
            },
          }),
        },
      },
    });
    const res = await handler("b1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agentId).toBe("b1");
    expect(data.displayName).toBe("Test Agent");
    expect(data.capabilities).toEqual(["text"]);
    expect(data.isActive).toBe(true);
  });

  it("returns 404 when agent doesn't exist", async () => {
    const handler = createAgentGetHandler({
      prismaClient: {
        agent: { findUnique: async () => null },
      },
    });
    const res = await handler("nonexistent");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Agent not found");
  });

  it("returns 404 when agent exists but has no AgentRegistration", async () => {
    const handler = createAgentGetHandler({
      prismaClient: {
        agent: {
          findUnique: async () => ({
            id: "b1",
            name: "UI Agent",
            agentRegistration: null, // Not a self-registered agent
          }),
        },
      },
    });
    const res = await handler("b1");
    expect(res.status).toBe(404);
  });
});

// ---- createAgentPatchHandler ----

describe("createAgentPatchHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makePatchHandler = (overrides = {}) =>
    createAgentPatchHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async ({ where }: any) => {
            if (
              where.apiKeyHash === TEST_API_KEY_HASH &&
              where.agentId === "agent-1"
            ) {
              return { id: "reg-1", agentId: "agent-1" };
            }
            return null;
          },
          update: async () => ({}),
        },
        agent: { update: async () => ({}) },
        $transaction: async (cb: any) =>
          cb({
            agent: { update: async () => ({}) },
            agentRegistration: { update: async () => ({}) },
          }),
        ...overrides,
      },
    });

  it("returns 200 on successful update", async () => {
    const handler = makePatchHandler();
    const res = await handler(
      makeAgentRequest({
        authHeader: `Bearer ${TEST_API_KEY}`,
        body: { displayName: "Updated Agent" },
      }),
      "agent-1",
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("returns 200 on partial update (subset of fields)", async () => {
    let capturedAgentUpdate: any = null;
    const handler = createAgentPatchHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => ({ id: "reg-1", agentId: "agent-1" }),
        },
        $transaction: async (cb: any) =>
          cb({
            agent: {
              update: async ({ data }: any) => {
                capturedAgentUpdate = data;
                return {};
              },
            },
            agentRegistration: { update: async () => ({}) },
          }),
      },
    });
    const res = await handler(
      makeAgentRequest({
        authHeader: `Bearer ${TEST_API_KEY}`,
        body: { displayName: "Just Name" },
      }),
      "agent-1",
    );
    expect(res.status).toBe(200);
    expect(capturedAgentUpdate.name).toBe("Just Name");
  });

  it("returns 401 for missing Authorization header", async () => {
    const handler = makePatchHandler();
    const res = await handler(
      makeAgentRequest({ body: { displayName: "X" } }),
      "agent-1",
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Missing Authorization header");
  });

  it("returns 401 for invalid API key", async () => {
    const handler = makePatchHandler();
    const res = await handler(
      makeAgentRequest({
        authHeader: "Bearer sk-tvk-wrong-key",
        body: { displayName: "X" },
      }),
      "agent-1",
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid API key");
  });

  it("returns 400 for invalid JSON body", async () => {
    const handler = makePatchHandler();
    const res = await handler(
      makeAgentRequest({
        authHeader: `Bearer ${TEST_API_KEY}`,
        throwOnJson: true,
      }),
      "agent-1",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 500 on database failure", async () => {
    const handler = createAgentPatchHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => ({ id: "reg-1", agentId: "agent-1" }),
        },
        $transaction: async () => {
          throw new Error("DB error");
        },
      },
    });
    const res = await handler(
      makeAgentRequest({
        authHeader: `Bearer ${TEST_API_KEY}`,
        body: { displayName: "X" },
      }),
      "agent-1",
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Update failed");
  });
});

// ---- createAgentDeleteHandler ----

describe("createAgentDeleteHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 on successful deregistration", async () => {
    let deletedId: string | null = null;
    const handler = createAgentDeleteHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => ({ id: "reg-1", agentId: "agent-1" }),
        },
        agent: {
          delete: async ({ where }: any) => {
            deletedId = where.id;
            return {};
          },
        },
      },
    });
    const res = await handler(
      makeAgentRequest({ authHeader: `Bearer ${TEST_API_KEY}` }),
      "agent-1",
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(deletedId).toBe("agent-1");
  });

  it("returns 401 for missing Authorization header", async () => {
    const handler = createAgentDeleteHandler({
      prismaClient: {},
    });
    const res = await handler(makeAgentRequest({}), "agent-1");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid API key", async () => {
    const handler = createAgentDeleteHandler({
      prismaClient: {
        agentRegistration: { findFirst: async () => null },
      },
    });
    const res = await handler(
      makeAgentRequest({ authHeader: "Bearer sk-tvk-wrong" }),
      "agent-1",
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 on database failure", async () => {
    const handler = createAgentDeleteHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => ({ id: "reg-1", agentId: "agent-1" }),
        },
        agent: {
          delete: async () => {
            throw new Error("FK constraint");
          },
        },
      },
    });
    const res = await handler(
      makeAgentRequest({ authHeader: `Bearer ${TEST_API_KEY}` }),
      "agent-1",
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Deregistration failed");
  });
});

// ---- createAgentVerifyHandler ----

describe("createAgentVerifyHandler", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  const makeVerifyHandler = (overrides = {}) =>
    createAgentVerifyHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async ({ where }: any) => {
            if (where.apiKeyHash === TEST_API_KEY_HASH) {
              return {
                id: "reg-1",
                capabilities: ["text"],
                agent: {
                  id: "b1",
                  name: "Test Agent",
                  avatarUrl: null,
                  serverId: "s1",
                  isActive: true,
                },
              };
            }
            return null;
          },
        },
        ...overrides,
      },
    });

  it("returns valid agent info for correct api_key", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: `http://localhost:5555/api/internal/agents/verify?api_key=${TEST_API_KEY}`,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.agentId).toBe("b1");
    expect(data.agentName).toBe("Test Agent");
    expect(data.serverId).toBe("s1");
    expect(data.capabilities).toEqual(["text"]);
  });

  it("returns 401 for invalid internal secret", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        secret: "wrong-secret",
        url: `http://localhost:5555/api/internal/agents/verify?api_key=${TEST_API_KEY}`,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for missing internal secret", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        url: `http://localhost:5555/api/internal/agents/verify?api_key=${TEST_API_KEY}`,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing api_key", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: "http://localhost:5555/api/internal/agents/verify",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid API key format");
  });

  it("returns 400 for key without sk-tvk- prefix", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: "http://localhost:5555/api/internal/agents/verify?api_key=invalid-key-format",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid API key format");
  });

  it("returns 404 for unknown api_key hash", async () => {
    const handler = makeVerifyHandler();
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: "http://localhost:5555/api/internal/agents/verify?api_key=sk-tvk-unknown-key-doesnt-exist",
      }),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("Agent not found");
  });

  it("returns 403 for deactivated agent", async () => {
    const handler = createAgentVerifyHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => ({
            id: "reg-1",
            capabilities: ["text"],
            agent: {
              id: "b1",
              name: "Deactivated Agent",
              avatarUrl: null,
              serverId: "s1",
              isActive: false, // Deactivated
            },
          }),
        },
      },
    });
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: `http://localhost:5555/api/internal/agents/verify?api_key=${TEST_API_KEY}`,
      }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("Agent is deactivated");
  });

  it("returns 500 on database error", async () => {
    const handler = createAgentVerifyHandler({
      prismaClient: {
        agentRegistration: {
          findFirst: async () => {
            throw new Error("Connection timeout");
          },
        },
      },
    });
    const res = await handler(
      makeAgentRequest({
        secret: "test-secret",
        url: `http://localhost:5555/api/internal/agents/verify?api_key=${TEST_API_KEY}`,
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Verification failed");
  });
});
