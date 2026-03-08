import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ulid } from "ulid";
import crypto from "crypto";
import { authenticateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/v1/webhooks — Create an inbound webhook (DEC-0045)
 *
 * Creates a Discord-style incoming webhook for a channel. Returns a URL
 * containing a token that any system can POST to (no headers needed).
 *
 * Auth: Bearer sk-tvk-... (agent API key)
 */
export async function POST(request: NextRequest) {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelId, name, avatarUrl } = body as {
    channelId?: string;
    name?: string;
    avatarUrl?: string;
  };

  if (!channelId || typeof channelId !== "string") {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 },
    );
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Verify channel exists and belongs to agent's server
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  if (channel.serverId !== agent.serverId) {
    return NextResponse.json(
      { error: "Channel does not belong to agent's server" },
      { status: 403 },
    );
  }

  // Keep the token under the 64-char DB limit: 4-char prefix + 43-char base64url
  const token = `whk_${crypto.randomBytes(32).toString("base64url")}`;
  const webhookId = ulid();

  try {
    const webhook = await prisma.inboundWebhook.create({
      data: {
        id: webhookId,
        channelId,
        botId: agent.botId,
        token,
        name: name.trim(),
        avatarUrl: (avatarUrl as string) || null,
      },
    });

    const webUrl = process.env.NEXTAUTH_URL || "http://localhost:5555";

    return NextResponse.json(
      {
        id: webhook.id,
        token, // Shown ONCE for security — not returned in list
        url: `${webUrl}/api/v1/webhooks/${token}`,
        channelId: webhook.channelId,
        name: webhook.name,
        avatarUrl: webhook.avatarUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Webhook creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/v1/webhooks?serverId=X — List inbound webhooks
 *
 * Auth: Bearer sk-tvk-... (agent API key)
 * Token is NOT returned in list responses for security.
 */
export async function GET(request: NextRequest) {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const serverId = searchParams.get("serverId");

  if (serverId && serverId !== agent.serverId) {
    return NextResponse.json(
      { error: "Server does not match agent's server" },
      { status: 403 },
    );
  }

  try {
    const webhooks = await prisma.inboundWebhook.findMany({
      where: { botId: agent.botId },
      select: {
        id: true,
        channelId: true,
        name: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ webhooks });
  } catch (error) {
    console.error("Failed to list webhooks:", error);
    return NextResponse.json(
      { error: "Failed to list webhooks" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/webhooks — Delete an inbound webhook (by webhookId in body)
 *
 * Auth: Bearer sk-tvk-... (agent API key)
 */
export async function DELETE(request: NextRequest) {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const webhookId = searchParams.get("webhookId");

  if (!webhookId) {
    return NextResponse.json(
      { error: "webhookId query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const webhook = await prisma.inboundWebhook.findUnique({
      where: { id: webhookId },
      select: { botId: true },
    });

    if (!webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    if (webhook.botId !== agent.botId) {
      return NextResponse.json(
        { error: "Not authorized to delete this webhook" },
        { status: 403 },
      );
    }

    await prisma.inboundWebhook.delete({ where: { id: webhookId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook deletion failed:", error);
    return NextResponse.json(
      { error: "Failed to delete webhook" },
      { status: 500 },
    );
  }
}
