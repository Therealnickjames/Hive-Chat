import { describe, it, expect } from "vitest";
import {
  Permissions,
  DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_INFO,
  hasPermission,
  computeMemberPermissions,
  serializePermissions,
  deserializePermissions,
} from "../permissions";

describe("Permissions constants", () => {
  it("each permission is a unique power of 2", () => {
    const values = Object.values(Permissions);
    const seen = new Set<bigint>();
    for (const v of values) {
      expect(v > 0n).toBe(true);
      // Must be a power of 2: (v & (v-1)) === 0
      expect(v & (v - 1n)).toBe(0n);
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  it("DEFAULT_PERMISSIONS includes SEND_MESSAGES and CREATE_INVITE", () => {
    expect(
      (DEFAULT_PERMISSIONS & Permissions.SEND_MESSAGES) ===
        Permissions.SEND_MESSAGES,
    ).toBe(true);
    expect(
      (DEFAULT_PERMISSIONS & Permissions.CREATE_INVITE) ===
        Permissions.CREATE_INVITE,
    ).toBe(true);
  });

  it("DEFAULT_PERMISSIONS does NOT include ADMINISTRATOR", () => {
    expect(
      (DEFAULT_PERMISSIONS & Permissions.ADMINISTRATOR) ===
        Permissions.ADMINISTRATOR,
    ).toBe(false);
  });

  it("ALL_PERMISSIONS includes every defined permission", () => {
    for (const perm of Object.values(Permissions)) {
      expect((ALL_PERMISSIONS & perm) === perm).toBe(true);
    }
  });

  it("PERMISSION_INFO covers all 9 permission keys", () => {
    const keys = PERMISSION_INFO.map((p) => p.key);
    expect(keys).toContain("SEND_MESSAGES");
    expect(keys).toContain("MANAGE_CHANNELS");
    expect(keys).toContain("MANAGE_BOTS");
    expect(keys).toContain("MANAGE_ROLES");
    expect(keys).toContain("CREATE_INVITE");
    expect(keys).toContain("KICK_MEMBERS");
    expect(keys).toContain("MANAGE_SERVER");
    expect(keys).toContain("MANAGE_MESSAGES");
    expect(keys).toContain("ADMINISTRATOR");
    expect(PERMISSION_INFO.length).toBe(9);
  });
});

describe("hasPermission", () => {
  it("returns true when the exact bit is set", () => {
    expect(
      hasPermission(Permissions.SEND_MESSAGES, Permissions.SEND_MESSAGES),
    ).toBe(true);
  });

  it("returns false when the bit is not set", () => {
    expect(
      hasPermission(Permissions.SEND_MESSAGES, Permissions.MANAGE_CHANNELS),
    ).toBe(false);
  });

  it("works with combined permissions (bitwise OR)", () => {
    const combined = Permissions.SEND_MESSAGES | Permissions.MANAGE_BOTS;
    expect(hasPermission(combined, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(combined, Permissions.MANAGE_BOTS)).toBe(true);
    expect(hasPermission(combined, Permissions.KICK_MEMBERS)).toBe(false);
  });

  it("ADMINISTRATOR bypasses all checks", () => {
    const adminOnly = Permissions.ADMINISTRATOR;
    expect(hasPermission(adminOnly, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(adminOnly, Permissions.MANAGE_SERVER)).toBe(true);
    expect(hasPermission(adminOnly, Permissions.KICK_MEMBERS)).toBe(true);
    expect(hasPermission(adminOnly, Permissions.MANAGE_MESSAGES)).toBe(true);
  });

  it("returns false for zero permissions", () => {
    expect(hasPermission(0n, Permissions.SEND_MESSAGES)).toBe(false);
    expect(hasPermission(0n, Permissions.ADMINISTRATOR)).toBe(false);
  });

  it("handles checking for a multi-bit permission mask", () => {
    const mask = Permissions.SEND_MESSAGES | Permissions.CREATE_INVITE;
    const perms =
      Permissions.SEND_MESSAGES |
      Permissions.CREATE_INVITE |
      Permissions.KICK_MEMBERS;
    // hasPermission checks (perms & mask) === mask
    expect(hasPermission(perms, mask)).toBe(true);

    // Missing CREATE_INVITE
    const partial = Permissions.SEND_MESSAGES | Permissions.KICK_MEMBERS;
    expect(hasPermission(partial, mask)).toBe(false);
  });
});

describe("computeMemberPermissions", () => {
  it("owner always gets ALL_PERMISSIONS regardless of roles", () => {
    const result = computeMemberPermissions("user-1", "user-1", []);
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it("owner gets ALL_PERMISSIONS even with empty role array", () => {
    const result = computeMemberPermissions("owner-id", "owner-id", []);
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it("non-owner gets combined permissions from all roles", () => {
    const roles = [
      { permissions: Permissions.SEND_MESSAGES },
      { permissions: Permissions.MANAGE_CHANNELS },
    ];
    const result = computeMemberPermissions("user-2", "user-1", roles);
    expect(result).toBe(
      Permissions.SEND_MESSAGES | Permissions.MANAGE_CHANNELS,
    );
  });

  it("non-owner with no roles gets zero permissions", () => {
    const result = computeMemberPermissions("user-2", "user-1", []);
    expect(result).toBe(0n);
  });

  it("duplicate permissions in multiple roles are idempotent", () => {
    const roles = [
      { permissions: Permissions.SEND_MESSAGES },
      { permissions: Permissions.SEND_MESSAGES | Permissions.CREATE_INVITE },
    ];
    const result = computeMemberPermissions("user-2", "user-1", roles);
    expect(result).toBe(Permissions.SEND_MESSAGES | Permissions.CREATE_INVITE);
  });
});

describe("serializePermissions / deserializePermissions", () => {
  it("round-trips correctly", () => {
    const original = Permissions.SEND_MESSAGES | Permissions.ADMINISTRATOR;
    const serialized = serializePermissions(original);
    const deserialized = deserializePermissions(serialized);
    expect(deserialized).toBe(original);
  });

  it("serializes to a decimal string", () => {
    const result = serializePermissions(Permissions.SEND_MESSAGES);
    expect(result).toBe("1");
    expect(typeof result).toBe("string");
  });

  it("deserializes from a decimal string", () => {
    const result = deserializePermissions("128");
    expect(result).toBe(Permissions.ADMINISTRATOR);
  });

  it("handles zero", () => {
    expect(serializePermissions(0n)).toBe("0");
    expect(deserializePermissions("0")).toBe(0n);
  });

  it("handles ALL_PERMISSIONS round-trip", () => {
    const serialized = serializePermissions(ALL_PERMISSIONS);
    const deserialized = deserializePermissions(serialized);
    expect(deserialized).toBe(ALL_PERMISSIONS);
  });
});
