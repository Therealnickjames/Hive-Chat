/**
 * HTTP client for calling Gateway internal APIs.
 *
 * Used by all non-WebSocket connectivity adapters (inbound webhooks,
 * REST polling, SSE, OpenAI-compat) to inject events into Phoenix
 * Channel rooms via the Gateway Broadcast Controller (DEC-0044).
 *
 * All methods use the INTERNAL_API_SECRET for authentication.
 */

const GATEWAY_INTERNAL_URL =
  process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_WEB_URL || "http://gateway:4001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

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
export async function broadcastToChannel(
  topic: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!INTERNAL_API_SECRET) {
    throw new Error("INTERNAL_API_SECRET is not configured");
  }

  const response = await fetch(`${GATEWAY_INTERNAL_URL}/api/internal/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_API_SECRET,
    },
    body: JSON.stringify({ topic, event, payload }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(
      `Gateway broadcast failed: ${response.status} ${response.statusText} — ${body}`
    );
  }
}

/**
 * Broadcast a new message event to a channel.
 * Convenience wrapper around broadcastToChannel.
 */
export async function broadcastMessageNew(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "message_new", payload);
}

/**
 * Broadcast a stream_start event to a channel.
 */
export async function broadcastStreamStart(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_start", payload);
}

/**
 * Broadcast a stream_token event to a channel.
 */
export async function broadcastStreamToken(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_token", payload);
}

/**
 * Broadcast a stream_complete event to a channel.
 */
export async function broadcastStreamComplete(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_complete", payload);
}

/**
 * Broadcast a stream_error event to a channel.
 */
export async function broadcastStreamError(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "stream_error", payload);
}

/**
 * Broadcast a typed_message event to a channel.
 */
export async function broadcastTypedMessage(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return broadcastToChannel(`room:${channelId}`, "typed_message", payload);
}
