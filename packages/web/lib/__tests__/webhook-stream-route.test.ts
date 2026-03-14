import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockBroadcastStreamComplete,
  mockBroadcastStreamError,
  mockBroadcastStreamToken,
  mockBroadcastToChannel,
  mockUpdateMessage,
} = vi.hoisted(() => ({
  mockPrisma: {
    inboundWebhook: {
      findUnique: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
    },
  },
  mockBroadcastStreamComplete: vi.fn(),
  mockBroadcastStreamError: vi.fn(),
  mockBroadcastStreamToken: vi.fn(),
  mockBroadcastToChannel: vi.fn(),
  mockUpdateMessage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/gateway-client", () => ({
  broadcastStreamComplete: mockBroadcastStreamComplete,
  broadcastStreamError: mockBroadcastStreamError,
  broadcastStreamToken: mockBroadcastStreamToken,
  broadcastToChannel: mockBroadcastToChannel,
}));

vi.mock("@/lib/internal-api-client", () => ({
  updateMessage: mockUpdateMessage,
}));

import { POST } from "@/app/api/v1/webhooks/[token]/stream/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/v1/webhooks/token/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/v1/webhooks/[token]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.inboundWebhook.findUnique.mockResolvedValue({
      channelId: "channel-1",
      agentId: "agent-1",
      isActive: true,
    });

    mockPrisma.message.findUnique.mockResolvedValue({
      id: "message-1",
      channelId: "channel-1",
      authorId: "agent-1",
      streamingStatus: "ACTIVE",
      isDeleted: false,
    });

    mockBroadcastStreamComplete.mockResolvedValue(undefined);
    mockBroadcastStreamError.mockResolvedValue(undefined);
    mockBroadcastStreamToken.mockResolvedValue(undefined);
    mockBroadcastToChannel.mockResolvedValue(undefined);
    mockUpdateMessage.mockResolvedValue(undefined);
  });

  it("preserves object metadata on completion for broadcast and persistence", async () => {
    const metadata = {
      model: "claude-sonnet-4-20250514",
      tokensOut: 843,
      latencyMs: 2300,
    };

    const response = await POST(
      makeRequest({
        messageId: "message-1",
        done: true,
        finalContent: "done",
        metadata,
      }),
      {
        params: Promise.resolve({ token: "whk_test" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      completed: true,
      tokensReceived: 0,
      nextTokenOffset: 0,
    });

    expect(mockBroadcastStreamComplete).toHaveBeenCalledWith("channel-1", {
      messageId: "message-1",
      finalContent: "done",
      metadata,
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith("message-1", {
      content: "done",
      streamingStatus: "COMPLETE",
      metadata,
    });
  });

  it("rejects non-object metadata before broadcasting or persisting", async () => {
    const response = await POST(
      makeRequest({
        messageId: "message-1",
        done: true,
        finalContent: "done",
        metadata: '{"model":"bad"}',
      }),
      {
        params: Promise.resolve({ token: "whk_test" }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "metadata must be a JSON object when provided",
    });

    expect(mockBroadcastStreamComplete).not.toHaveBeenCalled();
    expect(mockUpdateMessage).not.toHaveBeenCalled();
  });
});
