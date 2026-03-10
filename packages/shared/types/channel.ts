// Channel types — matches Prisma Channel model

export type ChannelType = "TEXT" | "ANNOUNCEMENT";

export interface Channel {
  id: string; // ULID
  serverId: string; // ULID
  name: string;
  topic: string | null;
  type: ChannelType;
  position: number;
  defaultAgentId: string | null; // ULID
  lastSequence: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
