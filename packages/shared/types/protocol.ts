// Protocol types — matches docs/PROTOCOL.md exactly
// Every WebSocket event and Redis pub/sub message shape is defined here.

import type { MessagePayload, StreamStatus } from "./message";

// ============================================================
// WEBSOCKET EVENTS (Phoenix Channels)
// ============================================================

// --- Client → Server ---

/** Client sends a new chat message */
export interface NewMessageEvent {
  content: string;
}

/** Client requests sync after reconnect */
export interface SyncEvent {
  lastSequence: string;
}

/** Client requests older message history */
export interface HistoryEvent {
  before?: string; // ULID cursor
  limit?: number; // default 50, max 100
}

/** Channel join params (sent with phx_join) */
export interface JoinParams {
  lastSequence?: string; // for reconnection sync
}

// --- Server → Client ---

/** Server broadcasts a new message */
export type MessageNewEvent = MessagePayload;

/** Server broadcasts stream start */
export interface StreamStartEvent {
  messageId: string;
  agentId: string;
  agentName: string;
  agentAvatarUrl: string | null;
  sequence: string;
}

/** Server broadcasts a streaming token */
export interface StreamTokenEvent {
  messageId: string;
  token: string;
  index: number; // monotonically increasing, 0-based
}

/** Server broadcasts stream completion */
export interface StreamCompleteEvent {
  messageId: string;
  finalContent: string;
}

/** Server broadcasts stream error */
export interface StreamErrorEvent {
  messageId: string;
  error: string;
  partialContent: string | null;
}

/** Server broadcasts typing indicator */
export interface UserTypingEvent {
  userId: string;
  username: string;
  displayName: string;
}

/** Server replies with synced messages */
export interface SyncResponseEvent {
  messages: MessagePayload[];
  hasMore: boolean;
}

/** Server replies with history page */
export interface HistoryResponseEvent {
  messages: MessagePayload[];
  hasMore: boolean;
}

// ============================================================
// REDIS PUB/SUB EVENTS
// ============================================================

/** Published to hive:stream:request — tells Go Proxy to start streaming */
export interface StreamRequestRedis {
  channelId: string;
  messageId: string;
  agentId: string;
  triggerMessageId: string;
  contextMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

/** Published to hive:stream:tokens:{channelId}:{messageId} */
export interface StreamTokenRedis {
  messageId: string;
  token: string;
  index: number;
}

/** Published to hive:stream:status:{channelId}:{messageId} */
export interface StreamStatusRedis {
  messageId: string;
  status: "complete" | "error";
  finalContent: string | null;
  error: string | null;
  partialContent?: string | null;
  tokenCount: number;
  durationMs: number;
}

// ============================================================
// HTTP INTERNAL API TYPES
// ============================================================

/** POST /api/internal/messages — request body */
export interface PersistMessageRequest {
  id: string;
  channelId: string;
  authorId: string;
  authorType: "USER" | "AGENT" | "SYSTEM";
  content: string;
  type: "STANDARD" | "STREAMING" | "SYSTEM";
  streamingStatus: StreamStatus | null;
  sequence: string;
}

/** GET /api/internal/messages — query params */
export interface FetchMessagesQuery {
  channelId: string;
  afterSequence?: string;
  before?: string; // ULID cursor
  limit?: number; // default 50, max 100
}

/** GET /api/internal/messages — response */
export interface FetchMessagesResponse {
  messages: MessagePayload[];
  hasMore: boolean;
}

/** Health check response (all services) */
export interface HealthResponse {
  status: "ok";
  service: "web" | "gateway" | "streaming";
  timestamp: string; // ISO 8601
}
