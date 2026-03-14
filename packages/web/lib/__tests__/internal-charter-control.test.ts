import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permissions } from "@/lib/permissions";

const { mockPrisma, mockValidateInternalSecret, mockCheckMemberPermission } =
  vi.hoisted(() => ({
    mockPrisma: {
      channel: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
    mockValidateInternalSecret: vi.fn(() => true),
    mockCheckMemberPermission: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/internal-auth", () => ({
  validateInternalSecret: mockValidateInternalSecret,
}));
vi.mock("@/lib/check-member-permission", () => ({
  checkMemberPermission: mockCheckMemberPermission,
}));

import { POST } from "@/app/api/internal/channels/[channelId]/charter-control/route";

const routeParams = {
  params: Promise.resolve({ channelId: "channel-1" }),
};

function makeRequest(body: unknown) {
  return new Request(
    "http://localhost/api/internal/channels/channel-1/charter-control",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as any;
}

describe("internal charter control auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockValidateInternalSecret.mockReturnValue(true);
    mockPrisma.channel.findUnique.mockResolvedValue({
      charterStatus: "ACTIVE",
      swarmMode: "ROUND_ROBIN",
      serverId: "server-1",
    });
    mockCheckMemberPermission.mockResolvedValue({ allowed: true });
    mockPrisma.channel.update.mockResolvedValue({
      id: "channel-1",
      swarmMode: "ROUND_ROBIN",
      charterStatus: "PAUSED",
      charterCurrentTurn: 2,
      charterMaxTurns: 8,
    });
  });

  it("rejects requests without the internal secret", async () => {
    mockValidateInternalSecret.mockReturnValue(false);

    const response = await POST(
      makeRequest({ action: "pause", userId: "user-1" }),
      routeParams,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects users who lack MANAGE_CHANNELS", async () => {
    mockCheckMemberPermission.mockResolvedValue({ allowed: false });

    const response = await POST(
      makeRequest({ action: "pause", userId: "user-2" }),
      routeParams,
    );

    expect(mockCheckMemberPermission).toHaveBeenCalledWith(
      "user-2",
      "server-1",
      Permissions.MANAGE_CHANNELS,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Missing permission: Manage Channels",
    });
    expect(mockPrisma.channel.update).not.toHaveBeenCalled();
  });

  it("updates charter state after an authorized action", async () => {
    mockPrisma.channel.findUnique.mockResolvedValue({
      charterStatus: "INACTIVE",
      swarmMode: "ROUND_ROBIN",
      serverId: "server-1",
    });
    mockPrisma.channel.update.mockResolvedValue({
      id: "channel-1",
      swarmMode: "ROUND_ROBIN",
      charterStatus: "ACTIVE",
      charterCurrentTurn: 0,
      charterMaxTurns: 8,
    });

    const response = await POST(
      makeRequest({ action: "start", userId: "user-1" }),
      routeParams,
    );

    expect(mockPrisma.channel.update).toHaveBeenCalledWith({
      where: { id: "channel-1" },
      data: {
        charterStatus: "ACTIVE",
        charterCurrentTurn: 0,
      },
      select: {
        id: true,
        swarmMode: true,
        charterStatus: true,
        charterCurrentTurn: true,
        charterMaxTurns: true,
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channelId: "channel-1",
      swarmMode: "ROUND_ROBIN",
      charterStatus: "ACTIVE",
      currentTurn: 0,
      maxTurns: 8,
      status: "ACTIVE",
    });
  });
});
