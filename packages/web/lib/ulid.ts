import { ulid } from "ulid";

/**
 * Generate a new ULID.
 * ULIDs are time-sortable, globally unique, and 26 characters long.
 * See docs/DECISIONS.md DEC-0004.
 */
export function generateId(): string {
  return ulid();
}

/**
 * Extract the timestamp from a ULID.
 * Useful for debugging — not for production time queries.
 */
export function extractTimestamp(id: string): Date {
  // ULID encoding: first 10 chars are timestamp (Crockford's base32)
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = 0;
  for (let i = 0; i < 10; i++) {
    timestamp = timestamp * 32 + ENCODING.indexOf(id[i].toUpperCase());
  }
  return new Date(timestamp);
}
