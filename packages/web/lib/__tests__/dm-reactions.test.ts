import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for DM reaction API route handlers.
 *
 * Since the DM reactions route (packages/web/app/api/dms/[dmId]/messages/[messageId]/reactions/route.ts)
 * directly imports prisma and next-auth at module level, we mock those modules
 * and then import the route handlers.
 */

// ---------- mocks ----------
// vi.hoisted ensures these are available when vi.mock factories run (hoisted above imports).

const { mockPrisma, mockSessionRef, mockGetServerSession } = vi.hoisted(() => {
  const _mockPrisma = {
    dmParticipant: { findUnique: vi.fn() },
    directMessage: { findUnique: vi.fn() },
    dmReaction: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const _mockSessionRef = { current: { user: { id: "user-1" } } as any };
  const _mockGetServerSession = vi.fn(() => Promise.resolve(_mockSessionRef.current));
  return {
    mockPrisma: _mockPrisma,
    mockSessionRef: _mockSessionRef,
    mockGetServerSession: _mockGetServerSession,
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));
vi.mock("@/lib/ulid", () => ({ generateId: () => "test-ulid-001" }));
vi.mock("@/lib/gateway-client", () => ({
  broadcastToChannel: vi.fn(() => Promise.resolve()),
}));

import { GET, POST, DELETE } from "@/app/api/dms/[dmId]/messages/[messageId]/reactions/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/dms/dm-1/messages/msg-1/reactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest(body: unknown) {
  return new Request("http://localhost/api/dms/dm-1/messages/msg-1/reactions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeGetRequest() {
  return new Request("http://localhost/api/dms/dm-1/messages/msg-1/reactions", {
    method: "GET",
  }) as any;
}

const routeParams = { params: Promise.resolve({ dmId: "dm-1", messageId: "msg-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: user is a participant, message belongs to DM
  mockPrisma.dmParticipant.findUnique.mockResolvedValue({ id: "part-1" });
  mockPrisma.directMessage.findUnique.mockResolvedValue({ dmId: "dm-1" });
  mockPrisma.dmReaction.findMany.mockResolvedValue([]);
  mockSessionRef.current = { user: { id: "user-1" } };
});

// ===========================================================
// Emoji validation
// ===========================================================
describe("DM reactions — emoji validation", () => {
  it("rejects empty emoji string", async () => {
    const res = await POST(makeRequest({ emoji: "" }), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });

  it("rejects whitespace-only emoji string", async () => {
    const res = await POST(makeRequest({ emoji: "   " }), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });

  it("rejects emoji string longer than 32 characters", async () => {
    const longEmoji = "a".repeat(33);
    const res = await POST(makeRequest({ emoji: longEmoji }), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });

  it("accepts a valid emoji (thumbs up)", async () => {
    mockPrisma.dmReaction.upsert.mockResolvedValue({});
    const res = await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(200);
  });

  it("accepts emoji at exactly 32 characters", async () => {
    const exactEmoji = "a".repeat(32);
    mockPrisma.dmReaction.upsert.mockResolvedValue({});
    const res = await POST(makeRequest({ emoji: exactEmoji }), routeParams);
    expect(res.status).toBe(200);
  });

  it("rejects missing emoji field", async () => {
    const res = await POST(makeRequest({}), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });

  it("DELETE also rejects empty emoji", async () => {
    const res = await DELETE(makeDeleteRequest({ emoji: "" }), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });

  it("DELETE also rejects emoji longer than 32 chars", async () => {
    const longEmoji = "x".repeat(33);
    const res = await DELETE(makeDeleteRequest({ emoji: longEmoji }), routeParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid emoji");
  });
});

// ===========================================================
// Authorization
// ===========================================================
describe("DM reactions — authorization", () => {
  it("returns 401 when not authenticated", async () => {
    mockSessionRef.current = null;
    const res = await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a DM participant (POST)", async () => {
    mockPrisma.dmParticipant.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Not a participant");
  });

  it("returns 403 when user is not a DM participant (GET)", async () => {
    mockPrisma.dmParticipant.findUnique.mockResolvedValue(null);
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Not a participant");
  });

  it("returns 403 when user is not a DM participant (DELETE)", async () => {
    mockPrisma.dmParticipant.findUnique.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Not a participant");
  });

  it("returns 404 when message does not belong to the DM", async () => {
    mockPrisma.directMessage.findUnique.mockResolvedValue({ dmId: "different-dm" });
    const res = await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Message not found");
  });

  it("returns 404 when message does not exist", async () => {
    mockPrisma.directMessage.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Message not found");
  });
});

// ===========================================================
// Idempotency
// ===========================================================
describe("DM reactions — idempotency", () => {
  it("adding same reaction twice uses upsert (no duplicate)", async () => {
    mockPrisma.dmReaction.upsert.mockResolvedValue({});

    // First add
    await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);
    // Second add (same emoji, same user)
    await POST(makeRequest({ emoji: "\u{1F44D}" }), routeParams);

    // upsert should be called both times — the unique constraint
    // (dmMessageId_userId_emoji) ensures no duplicate rows
    expect(mockPrisma.dmReaction.upsert).toHaveBeenCalledTimes(2);

    // Both calls should use the same composite where clause
    for (const call of mockPrisma.dmReaction.upsert.mock.calls) {
      expect(call[0].where.dmMessageId_userId_emoji).toEqual({
        dmMessageId: "msg-1",
        userId: "user-1",
        emoji: "\u{1F44D}",
      });
      // The upsert's update should be empty (no-op on duplicate)
      expect(call[0].update).toEqual({});
    }
  });

  it("upsert returns 200 on the second add (not 201)", async () => {
    mockPrisma.dmReaction.upsert.mockResolvedValue({});

    const res1 = await POST(makeRequest({ emoji: "\u{2764}\u{FE0F}" }), routeParams);
    const res2 = await POST(makeRequest({ emoji: "\u{2764}\u{FE0F}" }), routeParams);

    // Both should succeed with 200
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ===========================================================
// GET aggregation
// ===========================================================
describe("DM reactions — GET aggregation", () => {
  it("returns aggregated reactions with hasReacted flag", async () => {
    mockPrisma.dmReaction.findMany.mockResolvedValue([
      { emoji: "\u{1F44D}", userId: "user-1" },
      { emoji: "\u{1F44D}", userId: "user-2" },
      { emoji: "\u{2764}\u{FE0F}", userId: "user-2" },
    ]);

    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reactions).toBeDefined();

    const thumbsUp = json.reactions.find((r: any) => r.emoji === "\u{1F44D}");
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp.count).toBe(2);
    expect(thumbsUp.hasReacted).toBe(true);

    const heart = json.reactions.find((r: any) => r.emoji === "\u{2764}\u{FE0F}");
    expect(heart).toBeDefined();
    expect(heart.count).toBe(1);
    expect(heart.hasReacted).toBe(false);
  });

  it("returns empty reactions array when none exist", async () => {
    mockPrisma.dmReaction.findMany.mockResolvedValue([]);

    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reactions).toEqual([]);
  });
});
