// Server types — matches Prisma Server model

export interface Server {
  id: string; // ULID
  name: string;
  iconUrl: string | null;
  ownerId: string; // ULID
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Role within a server */
export interface Role {
  id: string; // ULID
  serverId: string;
  name: string;
  color: string | null; // hex e.g. "#FF5733"
  permissions: bigint; // bitfield
  position: number;
}

/** A user's membership in a server */
export interface Member {
  id: string; // ULID
  userId: string;
  serverId: string;
  nickname: string | null;
  joinedAt: string; // ISO 8601
  roleIds: string[]; // ULID[]
}
