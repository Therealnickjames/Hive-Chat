// User types — matches Prisma User model

export interface User {
  id: string; // ULID
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** User data safe to expose to other clients (no email/password) */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Presence status for a user */
export type UserStatus = "online" | "offline" | "away" | "dnd";
