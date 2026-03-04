/**
 * Mention parser utility for extracting mentioned user/bot IDs from message content.
 * Used by the message persistence handler to create MessageMention rows. (TASK-0015)
 *
 * V0's autocomplete inserts `@DisplayName ` (with trailing space) into the message.
 * This parser matches `@Name` patterns against known members and bots (case-insensitive).
 */

interface MentionTarget {
  id: string;
  name: string;
}

/**
 * Parse message content for @mentions and return unique IDs of mentioned users/bots.
 *
 * @param content - The message content to parse
 * @param members - Array of {id, name} for server members (name = displayName)
 * @param bots - Array of {id, name} for server bots
 * @returns Array of unique user/bot IDs that were mentioned
 */
export function parseMentionedUserIds(
  content: string,
  members: MentionTarget[],
  bots: MentionTarget[]
): string[] {
  if (!content || content.length === 0) return [];

  // Build a case-insensitive lookup map: lowercase name → id
  // If multiple targets share the same name (unlikely but possible),
  // the last one wins. This is fine for V1.
  const nameToId = new Map<string, string>();
  for (const m of members) {
    if (m.name) nameToId.set(m.name.toLowerCase(), m.id);
  }
  for (const b of bots) {
    if (b.name) nameToId.set(b.name.toLowerCase(), b.id);
  }

  if (nameToId.size === 0) return [];

  // Find all @mentions in content
  // Pattern: @ followed by one or more non-@ non-newline chars
  // We match greedily and then try progressively shorter substrings
  // against the name map to handle multi-word display names.
  const mentionedIds = new Set<string>();
  const regex = /@([^\n@]+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const afterAt = match[1];

    // Try progressively shorter substrings to match display names.
    // This handles "Nick is here" matching "@Nick" in "@Nick is here".
    // Start with the full string (trimmed), then try removing trailing words.
    const words = afterAt.trimEnd().split(/\s+/);
    let found = false;

    for (let len = words.length; len >= 1; len--) {
      const candidate = words.slice(0, len).join(" ").toLowerCase();
      const id = nameToId.get(candidate);
      if (id) {
        mentionedIds.add(id);
        found = true;
        break;
      }
    }

    // If no match with word boundaries, try exact match of the
    // first word alone (handles "Name," with trailing punctuation)
    if (!found) {
      const firstWord = words[0].replace(/[.,!?;:]+$/, "").toLowerCase();
      const id = nameToId.get(firstWord);
      if (id) {
        mentionedIds.add(id);
      }
    }
  }

  return Array.from(mentionedIds);
}
