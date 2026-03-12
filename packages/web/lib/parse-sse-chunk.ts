/** Parsed SSE event from an agent webhook stream. */
export interface SseTokenEvent {
  token?: string;
  done?: boolean;
  finalContent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parse SSE data lines from a buffered chunk, returning parsed events and
 * the remaining (incomplete) buffer.
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { events: SseTokenEvent[]; remaining: string } {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remaining = lines.pop() || "";
  const events: SseTokenEvent[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;

    try {
      events.push(JSON.parse(data) as SseTokenEvent);
    } catch {
      // Skip malformed SSE data
    }
  }

  return { events, remaining };
}
