import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateId } from "@/lib/ulid";
import crypto from "crypto";
import { authenticateAgentRequest } from "@/lib/agent-auth";
import { getInternalBaseUrl } from "@/lib/internal-auth";
import { verifyAgentChannelAccess } from "@/lib/agent-channel-acl";

/** Zod schema for webhook creation POST body. */
const webhookCreateSchema = z
  .object({
    channelId: z.string().min(1, "channelId is required"),
    name: z.string().min(1, "name is required"),
    avatarUrl: z.string().nullable().optional(),
  })
  .strict();

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

  let body: z.infer<typeof webhookCreateSchema>;
  try {
    const rawBody = await request.json();
    const parsed = webhookCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { error: firstError?.message || "Invalid request body" },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelId, name, avatarUrl } = body;

  const channelAccess = await verifyAgentChannelAccess(agent, channelId);
  if (!channelAccess.ok) {
    return NextResponse.json(
      { error: channelAccess.error },
      { status: channelAccess.status },
    );
  }

  // Keep the webhook token under the 64-char DB limit: 4-char prefix + 43-char base64url
  const webhookToken = `whk_${crypto.randomBytes(32).toString("base64url")}`;
  const webhookId = generateId();

  try {
    const webhook = await prisma.inboundWebhook.create({
      data: {
        id: webhookId,
        channelId,
        agentId: agent.agentId,
        token: webhookToken,
        name: name.trim(),
        avatarUrl: avatarUrl ?? null,
      },
    });

    const webUrl = getInternalBaseUrl();

    return NextResponse.json(
      {
        id: webhook.id,
        token: webhookToken, // Shown ONCE for security — not returned in list
        url: `${webUrl}/api/v1/webhooks/${webhookToken}`,
        channelId: webhook.channelId,
        name: webhook.name,
        avatarUrl: webhook.avatarUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[v1/webhooks] Webhook creation failed:", error);
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
      where: { agentId: agent.agentId },
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
    console.error("[v1/webhooks] Failed to list webhooks:", error);
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
      select: { agentId: true },
    });

    if (!webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    if (webhook.agentId !== agent.agentId) {
      return NextResponse.json(
        { error: "Not authorized to delete this webhook" },
        { status: 403 },
      );
    }

    await prisma.inboundWebhook.delete({ where: { id: webhookId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[v1/webhooks] Webhook deletion failed:", error);
    return NextResponse.json(
      { error: "Failed to delete webhook" },
      { status: 500 },
    );
  }
}
