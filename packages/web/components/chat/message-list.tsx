"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MessageItem } from "./message-item";
import { StreamingMessage } from "./streaming-message";
import { TypedMessageItem } from "./typed-message-item";
import { UnreadDivider } from "./unread-divider";

interface MessageListProps {
  messages: MessagePayload[];
  hasMoreHistory: boolean;
  onLoadHistory: () => void;
  onReactionsChange: (messageId: string, reactions: ReactionData[]) => void;
  currentUserId?: string;
  canManageMessages?: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => void;
  /** TASK-0016: sequence of last message the user has read (for divider placement) */
  lastReadSeq?: string | null;
  /** TASK-0012: number of concurrently active streams */
  activeStreamCount?: number;
}

export function MessageList({
  messages,
  hasMoreHistory,
  onLoadHistory,
  onReactionsChange,
  currentUserId,
  canManageMessages,
  onEditMessage,
  onDeleteMessage,
  lastReadSeq,
  activeStreamCount = 0,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  // Detect if user is near bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 50;

    // Load more history when scrolled to top
    if (el.scrollTop < 100 && hasMoreHistory) {
      onLoadHistory();
    }
  }, [hasMoreHistory, onLoadHistory]);

  // Auto-scroll to bottom on new messages or streaming content updates
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // Scroll on new message or if there's an active streaming message
    const hasActiveStream = messages.some(
      (m) => m.streamingStatus === "ACTIVE"
    );

    if (isNewMessage && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else if (hasActiveStream) {
      // Always follow active streams — don't let token growth outrun the viewport
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    const el = containerRef.current;
    if (el && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
    // Only run on first messages load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length > 0]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto pb-4"
    >
      {/* Loading indicator at top */}
      {hasMoreHistory && messages.length > 0 && (
        <div className="px-4 py-3 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="h-8 w-8 rounded-full bg-background-tertiary flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 rounded bg-background-tertiary" />
                <div className="h-3 rounded bg-background-tertiary" style={{ width: `${60 + i * 10}%` }} />
              </div>
            </div>
          ))}
          <div className="flex justify-center">
            <span className="text-[10px] text-text-dim font-mono tracking-wider">
              LOADING HISTORY
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-semibold text-text-primary">
              No messages yet
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Be the first to send a message!
            </p>
          </div>
        </div>
      )}

      {/* TASK-0012: Active streams indicator for multi-bot channels */}
      {activeStreamCount > 1 && (
        <div className="sticky top-0 z-10 flex justify-center py-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
            {activeStreamCount} agents responding
          </span>
        </div>
      )}

      {/* TASK-0016: Compute divider position — the index of the FIRST unread message */}
      {(() => {
        // Find the index where the divider should be inserted
        let dividerIndex = -1;
        if (lastReadSeq && lastReadSeq !== "0" && messages.length > 0) {
          const lrs = BigInt(lastReadSeq);
          for (let i = 0; i < messages.length; i++) {
            try {
              if (BigInt(messages[i].sequence) > lrs) {
                dividerIndex = i;
                break;
              }
            } catch {
              // skip if sequence isn't a valid bigint
            }
          }
          // If dividerIndex is 0 (all messages are unread) or -1 (all read), don't show
          if (dividerIndex <= 0) dividerIndex = -1;
        }
        return messages.map((message, index) => {
        const prevMessage = messages[index - 1];
        const isGrouped =
          prevMessage?.authorId === message.authorId &&
          prevMessage?.authorType === message.authorType &&
          // Don't group if previous message was deleted
          !prevMessage?.isDeleted &&
          !message.isDeleted &&
          // Only group if less than 5 minutes apart
          new Date(message.createdAt).getTime() -
            new Date(prevMessage.createdAt).getTime() <
            5 * 60 * 1000;

        const showDivider = index === dividerIndex;

        // Use StreamingMessage for active/recently-completed streaming messages
        if (message.type === "STREAMING") {
          return (
            <div key={message.id}>
              {showDivider && <UnreadDivider />}
              <StreamingMessage
                message={message}
                isGrouped={isGrouped}
                onReactionsChange={onReactionsChange}
                currentUserId={currentUserId}
                canManageMessages={canManageMessages}
                onDelete={onDeleteMessage}
              />
            </div>
          );
        }

        // Use TypedMessageItem for structured agent messages (TASK-0039)
        const typedTypes = ["TOOL_CALL", "TOOL_RESULT", "CODE_BLOCK", "ARTIFACT", "STATUS"];
        if (typedTypes.includes(message.type)) {
          return (
            <div key={message.id}>
              {showDivider && <UnreadDivider />}
              <TypedMessageItem
                message={message}
                isGrouped={isGrouped}
              />
            </div>
          );
        }

        return (
          <div key={message.id}>
            {showDivider && <UnreadDivider />}
            <MessageItem
              message={message}
              isGrouped={isGrouped}
              onReactionsChange={onReactionsChange}
              currentUserId={currentUserId}
              canManageMessages={canManageMessages}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
            />
          </div>
        );
      });
      })()}
    </div>
  );
}
