"use client";

import { useRef, useEffect, useCallback } from "react";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MessageItem } from "./message-item";
import { StreamingMessage } from "./streaming-message";

interface MessageListProps {
  messages: MessagePayload[];
  hasMoreHistory: boolean;
  onLoadHistory: () => void;
  onReactionsChange: (messageId: string, reactions: ReactionData[]) => void;
}

export function MessageList({
  messages,
  hasMoreHistory,
  onLoadHistory,
  onReactionsChange,
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
        <div className="flex justify-center py-4">
          <span className="text-xs text-text-muted">
            Scroll up to load more...
          </span>
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

      {/* Messages */}
      {messages.map((message, index) => {
        const prevMessage = messages[index - 1];
        const isGrouped =
          prevMessage?.authorId === message.authorId &&
          prevMessage?.authorType === message.authorType &&
          // Only group if less than 5 minutes apart
          new Date(message.createdAt).getTime() -
            new Date(prevMessage.createdAt).getTime() <
            5 * 60 * 1000;

        // Use StreamingMessage for active/recently-completed streaming messages
        if (message.type === "STREAMING") {
          return (
            <StreamingMessage
              key={message.id}
              message={message}
              isGrouped={isGrouped}
              onReactionsChange={onReactionsChange}
            />
          );
        }

        return (
          <MessageItem
            key={message.id}
            message={message}
            isGrouped={isGrouped}
            onReactionsChange={onReactionsChange}
          />
        );
      })}
    </div>
  );
}
