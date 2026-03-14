import { describe, expect, it, vi } from "vitest";
import { finalizeStreamCompletion } from "../stream-finalization";

describe("finalizeStreamCompletion", () => {
  it("uses the same metadata object for broadcast and persistence", async () => {
    const broadcastStreamCompleteFn = vi.fn().mockResolvedValue(undefined);
    const updateMessageFn = vi.fn().mockResolvedValue(undefined);
    const metadata = {
      model: "claude-sonnet-4-20250514",
      tokensOut: 843,
      latencyMs: 2300,
    };

    await finalizeStreamCompletion({
      channelId: "channel-1",
      messageId: "message-1",
      finalContent: "done",
      metadata,
      broadcastStreamCompleteFn,
      updateMessageFn,
    });

    expect(broadcastStreamCompleteFn).toHaveBeenCalledWith("channel-1", {
      messageId: "message-1",
      finalContent: "done",
      metadata,
    });

    expect(updateMessageFn).toHaveBeenCalledWith("message-1", {
      content: "done",
      streamingStatus: "COMPLETE",
      metadata,
    });
  });

  it("broadcasts null metadata and omits persistence metadata when absent", async () => {
    const broadcastStreamCompleteFn = vi.fn().mockResolvedValue(undefined);
    const updateMessageFn = vi.fn().mockResolvedValue(undefined);

    await finalizeStreamCompletion({
      channelId: "channel-2",
      messageId: "message-2",
      finalContent: "done",
      broadcastStreamCompleteFn,
      updateMessageFn,
    });

    expect(broadcastStreamCompleteFn).toHaveBeenCalledWith("channel-2", {
      messageId: "message-2",
      finalContent: "done",
      metadata: null,
    });

    expect(updateMessageFn).toHaveBeenCalledWith("message-2", {
      content: "done",
      streamingStatus: "COMPLETE",
    });
  });
});
