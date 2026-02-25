// Message types — matches Prisma Message model and PROTOCOL.md payloads

export type MessageType = "STANDARD" | "STREAMING" | "SYSTEM";
export type StreamStatus = "ACTIVE" | "COMPLETE" | "ERROR";
export type AuthorType = "USER" | "BOT" | "SYSTEM";

export interface Message {
  id: string; // ULID (time-sortable)
  channelId: string; // ULID
  authorId: string; // ULID (User.id or Bot.id)
  authorType: AuthorType;
  content: string;
  type: MessageType;
  streamingStatus: StreamStatus | null;
  sequence: string; // per-channel sequence number (BigInt-safe string)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Message payload as sent over WebSocket — includes author display info */
export interface MessagePayload {
  id: string;
  channelId: string;
  authorId: string;
  authorType: AuthorType;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  type: MessageType;
  streamingStatus: StreamStatus | null;
  sequence: string;
  createdAt: string;
}
