import { describe, it, expect } from "vitest";
import { parseSseChunk } from "@/lib/parse-sse-chunk";

describe("parseSseChunk", () => {
  it("parses a complete SSE data line with token", () => {
    const { events, remaining } = parseSseChunk(
      "",
      'data: {"token":"Hello"}\n',
    );
    expect(events).toEqual([{ token: "Hello" }]);
    expect(remaining).toBe("");
  });

  it("parses multiple events in one chunk", () => {
    const chunk = 'data: {"token":"A"}\ndata: {"token":"B"}\n';
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(2);
    expect(events[0].token).toBe("A");
    expect(events[1].token).toBe("B");
  });

  it("preserves incomplete lines as remaining buffer", () => {
    const { events, remaining } = parseSseChunk(
      "",
      'data: {"token":"A"}\ndata: {"tok',
    );
    expect(events).toHaveLength(1);
    expect(remaining).toBe('data: {"tok');
  });

  it("combines previous buffer with new chunk", () => {
    const { events } = parseSseChunk('data: {"tok', 'en":"Full"}\n');
    expect(events).toHaveLength(1);
    expect(events[0].token).toBe("Full");
  });

  it("skips [DONE] sentinel", () => {
    const { events } = parseSseChunk("", "data: [DONE]\n");
    expect(events).toHaveLength(0);
  });

  it("skips non-data lines", () => {
    const { events } = parseSseChunk(
      "",
      'event: message\nid: 123\ndata: {"token":"X"}\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].token).toBe("X");
  });

  it("skips malformed JSON gracefully", () => {
    const { events } = parseSseChunk(
      "",
      'data: not-json\ndata: {"token":"OK"}\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].token).toBe("OK");
  });

  it("parses done event with finalContent and metadata", () => {
    const chunk =
      'data: {"done":true,"finalContent":"complete text","metadata":{"model":"gpt-4"}}\n';
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(1);
    expect(events[0].done).toBe(true);
    expect(events[0].finalContent).toBe("complete text");
    expect(events[0].metadata).toEqual({ model: "gpt-4" });
  });

  it("returns empty events for empty input", () => {
    const { events, remaining } = parseSseChunk("", "");
    expect(events).toHaveLength(0);
    expect(remaining).toBe("");
  });
});
