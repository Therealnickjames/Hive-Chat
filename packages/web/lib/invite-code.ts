import crypto from "crypto";

/**
 * Generate a random 8-character alphanumeric invite code.
 * Uses crypto.randomBytes for secure randomness.
 * Character set: A-Z, a-z, 0-9 (62 chars, ~48 bits of entropy)
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
