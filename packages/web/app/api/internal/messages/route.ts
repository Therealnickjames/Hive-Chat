import { NextRequest, NextResponse } from "next/server";

// Internal API secret validation
function validateInternalSecret(request: NextRequest): boolean {
  const secret = request.headers.get("x-internal-secret");
  return secret === process.env.INTERNAL_API_SECRET;
}

/**
 * POST /api/internal/messages — Persist a message
 * Called by Gateway (for user messages) and Go Proxy (for completed streaming messages)
 * See docs/PROTOCOL.md §3
 */
export async function POST(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Implement message persistence via Prisma
  // For now, return a stub response
  const body = await request.json();

  return NextResponse.json(
    { message: "Message persistence not yet implemented", received: body },
    { status: 201 }
  );
}

/**
 * GET /api/internal/messages — Fetch messages for sync or history
 * Query params: channelId (required), afterSequence?, before?, limit?
 * See docs/PROTOCOL.md §3
 */
export async function GET(request: NextRequest) {
  if (!validateInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  if (!channelId) {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  // TODO: Implement message fetching via Prisma
  return NextResponse.json({
    messages: [],
    hasMore: false,
  });
}
