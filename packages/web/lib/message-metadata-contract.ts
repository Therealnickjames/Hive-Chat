export type MessageMetadata = Record<string, unknown>;

export function isMessageMetadata(value: unknown): value is MessageMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateOptionalMessageMetadata(
  value: unknown,
): { ok: true; metadata?: MessageMetadata } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (!isMessageMetadata(value)) {
    return {
      ok: false,
      error: "metadata must be a JSON object when provided",
    };
  }

  return { ok: true, metadata: value };
}
