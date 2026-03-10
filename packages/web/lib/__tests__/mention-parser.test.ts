import { describe, it, expect } from "vitest";
import { parseMentionedUserIds } from "../mention-parser";

const members = [
  { id: "user-1", name: "Alice" },
  { id: "user-2", name: "Bob Smith" },
  { id: "user-3", name: "Charlie" },
];

const agents = [
  { id: "agent-1", name: "GPT Agent" },
  { id: "agent-2", name: "Claude" },
];

describe("parseMentionedUserIds", () => {
  it("finds a single @mention of a member", () => {
    const result = parseMentionedUserIds(
      "Hey @Alice check this",
      members,
      agents,
    );
    expect(result).toEqual(["user-1"]);
  });

  it("finds multiple distinct mentions", () => {
    const result = parseMentionedUserIds(
      "@Alice and @Charlie please review",
      members,
      agents,
    );
    expect(result).toContain("user-1");
    expect(result).toContain("user-3");
    expect(result.length).toBe(2);
  });

  it("deduplicates repeated mentions of the same user", () => {
    const result = parseMentionedUserIds(
      "@Alice said hi, then @Alice said bye",
      members,
      agents,
    );
    expect(result).toEqual(["user-1"]);
  });

  it("matches multi-word display names", () => {
    const result = parseMentionedUserIds(
      "Hey @Bob Smith please help",
      members,
      agents,
    );
    expect(result).toEqual(["user-2"]);
  });

  it("does not match multi-word name when punctuation breaks the last word", () => {
    // Known V0 limitation: "Smith," !== "Smith" so "Bob Smith" won't match
    // when followed by a comma without space. This documents current behavior.
    const result = parseMentionedUserIds(
      "Hey @Bob Smith, can you help?",
      members,
      agents,
    );
    expect(result).toEqual([]);
  });

  it("matches agent names", () => {
    const result = parseMentionedUserIds(
      "@GPT Agent summarize this thread",
      members,
      agents,
    );
    expect(result).toEqual(["agent-1"]);
  });

  it("is case-insensitive", () => {
    const result = parseMentionedUserIds(
      "@alice and @CLAUDE respond",
      members,
      agents,
    );
    expect(result).toContain("user-1");
    expect(result).toContain("agent-2");
  });

  it("returns empty array for empty string", () => {
    expect(parseMentionedUserIds("", members, agents)).toEqual([]);
  });

  it("returns empty array when there are no mentions", () => {
    expect(parseMentionedUserIds("no mentions here", members, agents)).toEqual(
      [],
    );
  });

  it("returns empty array when members and agents are empty", () => {
    expect(parseMentionedUserIds("@Alice hello", [], [])).toEqual([]);
  });

  it("handles mention at start of message", () => {
    const result = parseMentionedUserIds("@Alice", members, agents);
    expect(result).toEqual(["user-1"]);
  });

  it("handles mention at end of message", () => {
    const result = parseMentionedUserIds("Hey @Alice", members, agents);
    expect(result).toEqual(["user-1"]);
  });

  it("handles mention with trailing punctuation", () => {
    const result = parseMentionedUserIds("Hello @Alice!", members, agents);
    expect(result).toEqual(["user-1"]);
  });

  it("handles mention followed by comma", () => {
    const result = parseMentionedUserIds(
      "@Alice, @Charlie, please review",
      members,
      agents,
    );
    expect(result).toContain("user-1");
    expect(result).toContain("user-3");
  });

  it("does not match partial names that aren't in the lookup", () => {
    const result = parseMentionedUserIds("@Unknown person", members, agents);
    expect(result).toEqual([]);
  });

  it("handles mixed members and agents in same message", () => {
    const result = parseMentionedUserIds(
      "@Alice ask @Claude about this",
      members,
      agents,
    );
    expect(result).toContain("user-1");
    expect(result).toContain("agent-2");
    expect(result.length).toBe(2);
  });

  it("handles members with null/empty names gracefully", () => {
    const membersWithNull = [...members, { id: "user-4", name: "" }];
    // Should not crash
    const result = parseMentionedUserIds(
      "@Alice hello",
      membersWithNull,
      agents,
    );
    expect(result).toEqual(["user-1"]);
  });
});
