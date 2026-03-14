import { broadcastStreamComplete } from "@/lib/gateway-client";
import { updateMessage } from "@/lib/internal-api-client";
import type { MessageMetadata } from "@/lib/message-metadata-contract";

interface FinalizeStreamCompletionArgs {
  channelId: string;
  messageId: string;
  finalContent: string;
  metadata?: MessageMetadata;
  broadcastStreamCompleteFn?: typeof broadcastStreamComplete;
  updateMessageFn?: typeof updateMessage;
}

/**
 * Broadcast and persist a completed stream using the same metadata shape for
 * both real-time delivery and Prisma JSON persistence.
 */
export async function finalizeStreamCompletion({
  channelId,
  messageId,
  finalContent,
  metadata,
  broadcastStreamCompleteFn = broadcastStreamComplete,
  updateMessageFn = updateMessage,
}: FinalizeStreamCompletionArgs): Promise<void> {
  await broadcastStreamCompleteFn(channelId, {
    messageId,
    finalContent,
    metadata: metadata ?? null,
  });

  await updateMessageFn(messageId, {
    content: finalContent,
    streamingStatus: "COMPLETE",
    ...(metadata !== undefined ? { metadata } : {}),
  });
}
