import crypto from "crypto";

/**
 * Generate a random 8-character alphanumeric invite code.
 * Uses crypto.randomBytes for secure randomness with rejection
 * sampling to eliminate modulo bias (ISSUE-028).
 *
 * Character set: A-Z, a-z, 0-9 (62 chars, ~47.6 bits of entropy)
 * Rejection threshold: 248 (largest multiple of 62 that fits in a byte)
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const maxUnbiased = 248; // Math.floor(256 / 62) * 62
  let code = "";

  while (code.length < 8) {
    // Generate extra bytes to minimize re-rolls (rejection rate is ~3%)
    const bytes = crypto.randomBytes(8 - code.length + 2);
    for (let i = 0; i < bytes.length && code.length < 8; i++) {
      if (bytes[i] < maxUnbiased) {
        code += chars[bytes[i] % chars.length];
      }
      // else: discard biased byte, try next one
    }
  }

  return code;
}
