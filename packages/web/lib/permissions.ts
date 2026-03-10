/**
 * Tavok Permission Bitfield
 *
 * Each permission is a power of 2. A role's permissions field is the
 * bitwise OR of all granted permissions. To check: (perms & bit) === bit.
 *
 * Owner always bypasses all checks (handled in computeMemberPermissions).
 */
const ONE = BigInt(1);
const ZERO = BigInt(0);

export const Permissions = {
  SEND_MESSAGES: ONE << BigInt(0),
  MANAGE_CHANNELS: ONE << BigInt(1),
  MANAGE_AGENTS: ONE << BigInt(2),
  MANAGE_ROLES: ONE << BigInt(3),
  CREATE_INVITE: ONE << BigInt(4),
  KICK_MEMBERS: ONE << BigInt(5),
  MANAGE_SERVER: ONE << BigInt(6),
  ADMINISTRATOR: ONE << BigInt(7),
  MANAGE_MESSAGES: ONE << BigInt(8), // TASK-0014: delete others' messages
} as const;

/** Default permissions for @everyone role */
export const DEFAULT_PERMISSIONS =
  Permissions.SEND_MESSAGES | Permissions.CREATE_INVITE;

/** All permissions combined */
export const ALL_PERMISSIONS = Object.values(Permissions).reduce(
  (acc, permission) => acc | permission,
  ZERO,
);

/** Human-readable permission info for UI */
export const PERMISSION_INFO: {
  key: string;
  bit: bigint;
  label: string;
  description: string;
}[] = [
  {
    key: "SEND_MESSAGES",
    bit: Permissions.SEND_MESSAGES,
    label: "Send Messages",
    description: "Send messages in text channels",
  },
  {
    key: "MANAGE_CHANNELS",
    bit: Permissions.MANAGE_CHANNELS,
    label: "Manage Channels",
    description: "Create, edit, and delete channels",
  },
  {
    key: "MANAGE_AGENTS",
    bit: Permissions.MANAGE_AGENTS,
    label: "Manage Agents",
    description: "Create, edit, and delete agents",
  },
  {
    key: "MANAGE_ROLES",
    bit: Permissions.MANAGE_ROLES,
    label: "Manage Roles",
    description: "Create, edit, and delete roles",
  },
  {
    key: "CREATE_INVITE",
    bit: Permissions.CREATE_INVITE,
    label: "Create Invites",
    description: "Create invite links for the server",
  },
  {
    key: "KICK_MEMBERS",
    bit: Permissions.KICK_MEMBERS,
    label: "Kick Members",
    description: "Remove members from the server",
  },
  {
    key: "MANAGE_SERVER",
    bit: Permissions.MANAGE_SERVER,
    label: "Manage Server",
    description: "Edit server name and icon",
  },
  {
    key: "MANAGE_MESSAGES",
    bit: Permissions.MANAGE_MESSAGES,
    label: "Manage Messages",
    description: "Delete messages from other users",
  },
  {
    key: "ADMINISTRATOR",
    bit: Permissions.ADMINISTRATOR,
    label: "Administrator",
    description: "All permissions (bypasses all checks)",
  },
];

/**
 * Check if a permissions bitfield has a specific permission.
 */
export function hasPermission(
  permissions: bigint,
  permission: bigint,
): boolean {
  if ((permissions & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
    return true;
  }

  return (permissions & permission) === permission;
}

/**
 * Compute effective permissions for a member in a server.
 * Combines all role permissions via bitwise OR.
 * Owner always gets ALL_PERMISSIONS.
 */
export function computeMemberPermissions(
  userId: string,
  ownerId: string,
  roles: { permissions: bigint }[],
): bigint {
  if (userId === ownerId) {
    return ALL_PERMISSIONS;
  }

  return roles.reduce((acc, role) => acc | role.permissions, ZERO);
}

/**
 * Serialize BigInt permissions to a string for JSON responses.
 * JSON.stringify can't handle BigInt natively.
 */
export function serializePermissions(permissions: bigint): string {
  return permissions.toString();
}

/**
 * Deserialize a permissions string back to BigInt.
 */
export function deserializePermissions(permissions: string): bigint {
  return BigInt(permissions);
}
