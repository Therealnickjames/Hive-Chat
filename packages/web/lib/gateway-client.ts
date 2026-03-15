/**
 * HTTP client for calling Gateway internal APIs.
 *
 * Used by all non-WebSocket connectivity adapters (inbound webhooks,
 * REST polling, SSE, OpenAI-compat) to inject events into Phoenix
 * Channel rooms via the Gateway Broadcast Controller (DEC-0044).
 *
 * All methods use the INTERNAL_API_SECRET for authentication.
 */

// ---------------------------------------------------------------------------
// Typed broadcast payload interfaces
// ---------------------------------------------------------------------------

export interface MessageNewPayload {
  id: string;
  channelId: string;
  authorId: string;
  authorType: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  type: string;
  streamingStatus: string | null;
  sequence: string;
  createdAt: string;
}

export interface StreamStartPayload {
  messageId: string;
  agentId: string;
  agentName: string;
  agentAvatarUrl: string | null;
  sequence: string;
}

export interface StreamTokenPayload {
  messageId: string;
  token: string;
  index: number;
}

export interface StreamCompletePayload {
  messageId: string;
  content?: string;
  finalContent?: string;
  sequence?: string;
  metadata?: Record<string, unknown> | null;
}

export interface StreamErrorPayload {
  messageId: string;
  error: string;
  partialContent?: string | null;
}

export interface TypedMessagePayload {
  id: string;
  channelId: string;
  authorId: string;
  authorType: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  type: string;
  streamingStatus?: string | null;
  sequence: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getGatewayInternalUrl(): string {
  return (
    process.env.GATEWAY_INTERNAL_URL ||
    process.env.GATEWAY_WEB_URL ||
    "http://gateway:4001"
  );
}

function getInternalApiSecret(): string | undefined {
  return process.env.INTERNAL_API_SECRET;
}

function internalHeaders(requestId?: string): Record<string, string> {
  const secret = getInternalApiSecret();
  if (!secret) throw new Error("INTERNAL_API_SECRET is not configured");
  const h: Record<string, string> = {
    "x-internal-secret": secret,
  };
  if (requestId) h["x-request-id"] = requestId;
  return h;
}

/**
 * Broadcast an event to a Phoenix Channel topic.
 *
 * This calls the Gateway's POST /api/internal/broadcast endpoint,
 * which in turn calls Broadcast.endpoint_broadcast!/3 for pre-serialized
 * zero-copy fan-out to all connected WebSocket clients.
 *
 * @param topic - Phoenix Channel topic (e.g., "room:01HXY...")
 * @param event - Event name (e.g., "message_new", "stream_start", "stream_token")
 * @param payload - Event payload (will be JSON-serialized)
 */
export async function broadcastToChannel<T extends object>(
  topic: string,
  event: string,
  payload: T,
  requestId?: string,
): Promise<void> {
  const gatewayUrl = getGatewayInternalUrl();
  const response = await fetch(`${gatewayUrl}/api/internal/broadcast`, {
    method: "POST",
    headers: { ...internalHeaders(requestId), "Content-Type": "application/json" },
    body: JSON.stringify({ topic, event, payload }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(
      `Gateway broadcast failed: ${response.status} ${response.statusText} — ${body}`,
    );
  }
}

export async function broadcastMessageNew(
  channelId: string,
  payload: MessageNewPayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "message_new", payload);
}

export async function broadcastStreamStart(
  channelId: string,
  payload: StreamStartPayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_start", payload);
}

export async function broadcastStreamToken(
  channelId: string,
  payload: StreamTokenPayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_token", payload);
}

export async function broadcastStreamComplete(
  channelId: string,
  payload: StreamCompletePayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_complete", payload);
}

export async function broadcastStreamError(
  channelId: string,
  payload: StreamErrorPayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_error", payload);
}

export async function broadcastTypedMessage(
  channelId: string,
  payload: TypedMessagePayload,
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "typed_message", payload);
}

/**
 * Fetch the next Gateway-owned monotonic sequence for a channel.
 */
export async function fetchChannelSequence(
  channelId: string,
  requestId?: string,
): Promise<string> {
  const gatewayUrl = getGatewayInternalUrl();
  const response = await fetch(
    `${gatewayUrl}/api/internal/sequence?channelId=${encodeURIComponent(channelId)}`,
    {
      headers: internalHeaders(requestId),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(
      `Gateway sequence fetch failed: ${response.status} ${response.statusText} — ${body}`,
    );
  }

  const body = (await response.json().catch(() => null)) as {
    sequence?: unknown;
  } | null;

  if (typeof body?.sequence !== "string" || !/^\d+$/.test(body.sequence)) {
    throw new Error("Gateway sequence response missing numeric sequence");
  }

  return body.sequence;
}
