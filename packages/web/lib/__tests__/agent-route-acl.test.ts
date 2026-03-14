// @ts-nocheck -- route tests use partial Prisma mocks
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockAuthenticateAgentRequest,
  mockAuthenticateAgentKey,
  mockCheckAgentRateLimit,
  mockLogAgentAction,
} = vi.hoisted(() => {
  const fixtures = {
    server: {
      id: "server-1",
      name: "Tavok Test",
      iconUrl: null,
    },
    channels: [
      {
        id: "channel-assigned",
        serverId: "server-1",
        name: "general",
        topic: "Assigned channel",
        type: "TEXT",
        position: 0,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        assignedAgentIds: ["agent-1", "agent-2"],
      },
      {
        id: "channel-unassigned",
        serverId: "server-1",
        name: "private-review",
        topic: "Unassigned channel",
        type: "TEXT",
        position: 1,
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
        assignedAgentIds: ["agent-2"],
      },
      {
        id: "channel-other-server",
        serverId: "server-2",
        name: "elsewhere",
        topic: "Other server",
        type: "TEXT",
        position: 0,
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
        assignedAgentIds: ["agent-1"],
      },
    ],
    agents: [
      {
        id: "agent-1",
        name: "SDK Agent",
        avatarUrl: null,
        triggerMode: "MENTION",
        connectionMethod: "SSE",
        isActive: true,
        serverId: "server-1",
      },
      {
        id: "agent-2",
        name: "Other Agent",
        avatarUrl: null,
        triggerMode: "MENTION",
        connectionMethod: "WEBSOCKET",
        isActive: true,
        serverId: "server-1",
      },
    ],
  };

  function matchesChannelWhere(channel: any, where: any = {}) {
    if (!where) return true;

    if (typeof where.serverId === "string" && channel.serverId !== where.serverId) {
      return false;
    }

    if (typeof where.id === "string" && channel.id !== where.id) {
      return false;
    }

    if (where.id?.in && !where.id.in.includes(channel.id)) {
      return false;
    }

    const assignedAgentId = where.channelAgents?.some?.agentId;
    if (
      typeof assignedAgentId === "string" &&
      !channel.assignedAgentIds.includes(assignedAgentId)
    ) {
      return false;
    }

    return true;
  }

  function selectFields(source: any, select: any) {
    if (!select) {
      return { ...source };
    }

    const selected: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(select)) {
      if (value === true) {
        selected[field] = source[field];
      }
    }
    return selected;
  }

  const prisma = {
    channel: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const channel = fixtures.channels.find((candidate) =>
          matchesChannelWhere(candidate, where),
        );
        return channel ? selectFields(channel, select) : null;
      }),
      findMany: vi.fn(async ({ where, select, orderBy }: any = {}) => {
        let channels = fixtures.channels.filter((channel) =>
          matchesChannelWhere(channel, where),
        );

        if (orderBy?.position === "asc") {
          channels = channels.toSorted((left, right) => left.position - right.position);
        }

        return channels.map((channel) => selectFields(channel, select));
      }),
    },
    server: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        if (where?.id !== fixtures.server.id) {
          return null;
        }

        const response: Record<string, unknown> = {};
        if (select?.id) response.id = fixtures.server.id;
        if (select?.name) response.name = fixtures.server.name;
        if (select?.iconUrl) response.iconUrl = fixtures.server.iconUrl;

        if (select?.channels) {
          let channels = fixtures.channels.filter(
            (channel) => channel.serverId === fixtures.server.id,
          );
          channels = channels.filter((channel) =>
            matchesChannelWhere(channel, select.channels.where),
          );

          if (select.channels.orderBy?.position === "asc") {
            channels = channels.toSorted(
              (left, right) => left.position - right.position,
            );
          }

          response.channels = channels.map((channel) =>
            selectFields(channel, select.channels.select),
          );
        }

        if (select?.agents) {
          let agents = fixtures.agents.filter(
            (agent) => agent.serverId === fixtures.server.id,
          );

          if (typeof select.agents.where?.isActive === "boolean") {
            agents = agents.filter(
              (agent) => agent.isActive === select.agents.where.isActive,
            );
          }

          response.agents = agents.map((agent) =>
            selectFields(agent, select.agents.select),
          );
        }

        return response;
      }),
    },
    channelAgent: {
      findFirst: vi.fn(async ({ where }: any) => {
        const channel = fixtures.channels.find((candidate) => candidate.id === where.channelId);
        if (!channel || !channel.assignedAgentIds.includes(where.agentId)) {
          return null;
        }
        return { id: `acl-${where.channelId}-${where.agentId}` };
      }),
      findMany: vi.fn(async ({ where, select }: any) => {
        const rows = fixtures.channels
          .filter((channel) => {
            if (where?.channelId?.in && !where.channelId.in.includes(channel.id)) {
              return false;
            }
            return channel.assignedAgentIds.includes(where.agentId);
          })
          .map((channel) => ({ channelId: channel.id }));

        if (!select) {
          return rows;
        }

        return rows.map((row) => selectFields(row, select));
      }),
    },
    agentMessage: {
      findMany: vi.fn(async () => []),
    },
  };

  return {
    mockPrisma: prisma,
    mockAuthenticateAgentRequest: vi.fn(),
    mockAuthenticateAgentKey: vi.fn(),
    mockCheckAgentRateLimit: vi.fn(),
    mockLogAgentAction: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/agent-auth", () => ({
  authenticateAgentRequest: mockAuthenticateAgentRequest,
  authenticateAgentKey: mockAuthenticateAgentKey,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkAgentRateLimit: mockCheckAgentRateLimit,
}));
vi.mock("@/lib/agent-audit", () => ({
  logAgentAction: mockLogAgentAction,
}));
vi.mock("@/lib/gateway-client", () => ({
  broadcastMessageNew: vi.fn(),
  broadcastStreamStart: vi.fn(),
  fetchChannelSequence: vi.fn(async () => "1"),
}));
vi.mock("@/lib/internal-auth", () => ({
  getInternalBaseUrl: vi.fn(() => "http://localhost"),
}));
vi.mock("@/lib/internal-api-client", () => ({
  persistMessage: vi.fn(),
}));
vi.mock("@/lib/ulid", () => ({
  generateId: vi.fn(() => "generated-id"),
}));

import { GET as getModels } from "@/app/api/v1/models/route";
import { GET as getEvents } from "@/app/api/v1/agents/[id]/events/route";
import { GET as getServer } from "@/app/api/v1/agents/[id]/server/route";
import { GET as getMessages } from "@/app/api/v1/agents/[id]/messages/route";
import { GET as getChannelMessages } from "@/app/api/v1/agents/[id]/channels/[channelId]/messages/route";
import { POST as postChatCompletions } from "@/app/api/v1/chat/completions/route";
import { POST as postWebhook } from "@/app/api/v1/webhooks/route";

const agentAuth = {
  agentId: "agent-1",
  agentName: "SDK Agent",
  agentAvatarUrl: null,
  serverId: "server-1",
  capabilities: [],
  connectionMethod: "SSE",
};

function makeRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer sk-tvk-test",
      ...(init.headers ?? {}),
    },
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateAgentRequest.mockResolvedValue(agentAuth);
  mockAuthenticateAgentKey.mockResolvedValue(agentAuth);
  mockCheckAgentRateLimit.mockReturnValue({
    allowed: true,
    resetAt: Date.now() + 60_000,
  });
});

describe("agent route ACL normalization", () => {
  it("lists only assigned channels in OpenAI model discovery", async () => {
    const response = await getModels(makeRequest("http://localhost/api/v1/models"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "list",
      data: [{ id: "tavok-channel-channel-assigned" }],
    });
  });

  it("rejects SSE subscriptions to same-server channels the agent is not assigned to", async () => {
    const response = await getEvents(
      makeRequest(
        "http://localhost/api/v1/agents/agent-1/events?channels=channel-assigned,channel-unassigned",
      ),
      { params: Promise.resolve({ id: "agent-1" }) },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("only exposes assigned channels in server discovery while keeping server-scoped agent discovery explicit", async () => {
    const response = await getServer(
      makeRequest("http://localhost/api/v1/agents/agent-1/server"),
      { params: Promise.resolve({ id: "agent-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      server: { id: "server-1", name: "Tavok Test" },
      channels: [{ id: "channel-assigned", websocketTopic: "room:channel-assigned" }],
      agents: [{ id: "agent-1" }, { id: "agent-2" }],
    });
  });

  it("rejects channel-filtered polling for same-server channels the agent is not assigned to", async () => {
    const response = await getMessages(
      makeRequest(
        "http://localhost/api/v1/agents/agent-1/messages?channel_id=channel-unassigned",
      ),
      { params: Promise.resolve({ id: "agent-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Agent is not assigned to this channel",
    });
  });

  it("rejects channel history reads for same-server channels the agent is not assigned to", async () => {
    const response = await getChannelMessages(
      makeRequest(
        "http://localhost/api/v1/agents/agent-1/channels/channel-unassigned/messages",
      ),
      {
        params: Promise.resolve({
          id: "agent-1",
          channelId: "channel-unassigned",
        }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Agent is not assigned to this channel",
    });
  });

  it("rejects OpenAI-compatible completions for same-server channels the agent is not assigned to", async () => {
    const response = await postChatCompletions(
      makeRequest("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "tavok-channel-channel-unassigned",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthorized_channel",
        message: "Agent is not assigned to this channel",
      },
    });
  });

  it("rejects inbound webhook creation for same-server channels the agent is not assigned to", async () => {
    const response = await postWebhook(
      makeRequest("http://localhost/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: "channel-unassigned",
          name: "Build Hook",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Agent is not assigned to this channel",
    });
  });
});
