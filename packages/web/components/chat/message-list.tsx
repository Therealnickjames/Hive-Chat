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
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const hasSeededSeenMessageIdsRef = useRef(false);
  const prioritizedIncomingUserMessageIdRef = useRef<string | null>(null);
  const latestOwnUserMessageId = useMemo(() => {
    if (!currentUserId) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.authorType === "USER" && msg.authorId === currentUserId) {
        return msg.id;
      }
    }
    return null;
  }, [messages, currentUserId]);

  // Detect if user is near bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
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

    const newlyAddedMessages: MessagePayload[] = [];
    if (!hasSeededSeenMessageIdsRef.current) {
      if (messages.length > 0) {
        messages.forEach((m) => seenMessageIdsRef.current.add(m.id));
        hasSeededSeenMessageIdsRef.current = true;
      }
    } else {
      for (const m of messages) {
        if (!seenMessageIdsRef.current.has(m.id)) {
          seenMessageIdsRef.current.add(m.id);
          newlyAddedMessages.push(m);
        }
      }
    }

    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // Scroll on new message or if there's an active streaming message
    const hasActiveStream = messages.some(
      (m) => m.streamingStatus === "ACTIVE",
    );
    const latestMessage = messages[messages.length - 1];
    const typedAgentTypes = [
      "TOOL_CALL",
      "TOOL_RESULT",
      "CODE_BLOCK",
      "ARTIFACT",
      "STATUS",
    ];
    const isLatestAgentStream = Boolean(
      latestMessage &&
      latestMessage.authorType === "AGENT" &&
      latestMessage.type === "STREAMING",
    );
    const isLatestAgentTyped = Boolean(
      latestMessage &&
      latestMessage.authorType === "AGENT" &&
      typedAgentTypes.includes(latestMessage.type),
    );
    const isLatestUserMessage = Boolean(
      latestMessage && latestMessage.authorType === "USER",
    );
    const isLatestOwnUserMessage = Boolean(
      latestMessage &&
      latestMessage.authorType === "USER" &&
      currentUserId &&
      latestMessage.authorId === currentUserId,
    );
    const isLatestIncomingUserMessage = Boolean(
      latestMessage &&
      latestMessage.authorType === "USER" &&
      currentUserId &&
      latestMessage.authorId !== currentUserId,
    );
    const incomingUserCandidate = newlyAddedMessages.findLast(
      (m) =>
        Boolean(currentUserId) &&
        m.authorType === "USER" &&
        m.authorId !== currentUserId,
    );
    const incomingUserCandidateAgeMs = incomingUserCandidate
      ? Date.now() - new Date(incomingUserCandidate.createdAt).getTime()
      : null;
    const newIncomingUserMessage =
      incomingUserCandidate &&
      incomingUserCandidateAgeMs !== null &&
      incomingUserCandidateAgeMs >= 0 &&
      incomingUserCandidateAgeMs < 30_000
        ? incomingUserCandidate
        : null;
    const hasNewIncomingUserMessage = Boolean(newIncomingUserMessage);
    if (newIncomingUserMessage) {
      prioritizedIncomingUserMessageIdRef.current = newIncomingUserMessage.id;
    }
    const prevMessage = messages[messages.length - 2];
    const latestUserGrouped = Boolean(
      isLatestUserMessage &&
      prevMessage &&
      prevMessage.authorId === latestMessage?.authorId &&
      prevMessage.authorType === latestMessage?.authorType &&
      !prevMessage.isDeleted &&
      !latestMessage?.isDeleted &&
      new Date(latestMessage!.createdAt).getTime() -
        new Date(prevMessage.createdAt).getTime() <
        5 * 60 * 1000,
    );
    const shouldFollowNewAgentStreamOutcome =
      isNewMessage && isLatestAgentStream;
    const shouldFollowOwnSentMessage = isNewMessage && isLatestOwnUserMessage;
    const shouldFollowIncomingUserMessage =
      hasNewIncomingUserMessage ||
      (isNewMessage && isLatestIncomingUserMessage);
    const shouldFollowTypedAgentMessage = isNewMessage && isLatestAgentTyped;
    const prioritizedIncomingUserMessageId =
      prioritizedIncomingUserMessageIdRef.current;
    if (
      prioritizedIncomingUserMessageId &&
      !messages.some((m) => m.id === prioritizedIncomingUserMessageId)
    ) {
      prioritizedIncomingUserMessageIdRef.current = null;
    }
    if (isNewMessage && isLatestOwnUserMessage) {
      prioritizedIncomingUserMessageIdRef.current = null;
    }
    const shouldPinIncomingUserMessage = Boolean(
      prioritizedIncomingUserMessageIdRef.current,
    );
    const shouldFollowActiveStream =
      hasActiveStream && !shouldPinIncomingUserMessage;
    const willScroll =
      (isNewMessage && isAtBottomRef.current) ||
      shouldFollowActiveStream ||
      shouldFollowNewAgentStreamOutcome ||
      shouldFollowOwnSentMessage ||
      shouldFollowIncomingUserMessage ||
      shouldFollowTypedAgentMessage;

    if (willScroll) {
      const pinnedId = prioritizedIncomingUserMessageIdRef.current;
      if (pinnedId) {
        const pinnedRow = el.querySelector<HTMLElement>(
          `[data-message-id="${pinnedId}"]`,
        );
        pinnedRow?.scrollIntoView({ block: "nearest" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages, currentUserId]);

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
      className="flex-1 overflow-y-auto px-2 pb-4 pt-3"
    >
      {/* Loading indicator at top */}
      {hasMoreHistory && messages.length > 0 && (
        <div className="space-y-3 px-4 py-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-background-tertiary/80" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 rounded bg-background-tertiary/80" />
                <div
                  className="h-3 rounded bg-background-tertiary/80"
                  style={{ width: `${60 + i * 10}%` }}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-center">
            <span className="text-[10px] font-mono tracking-[0.16em] text-text-dim">
              LOADING HISTORY
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center px-4 py-10">
          <div className="chrome-card rounded-[24px] px-8 py-10 text-center">
            <p className="font-display text-xl font-semibold text-white">
              No messages yet
            </p>
            <p className="mt-2 text-sm text-text-muted">
              Be the first to send a message!
            </p>
          </div>
        </div>
      )}

      {/* TASK-0012: Active streams indicator for multi-agent channels */}
      {activeStreamCount > 1 && (
        <div className="sticky top-0 z-10 flex justify-center py-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-cyan/20 bg-accent-cyan/10 px-3 py-1.5 text-xs font-medium text-accent-cyan shadow-[0_10px_24px_rgba(89,184,255,0.1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-agent animate-pulse" />
            {activeStreamCount} agents responding
          </span>
        </div>
      )}

      {/* TASK-0016: Compute divider position â€” the index of the FIRST unread message */}
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
          let isGrouped =
            prevMessage?.authorId === message.authorId &&
            prevMessage?.authorType === message.authorType &&
            // Don't group if previous message was deleted
            !prevMessage?.isDeleted &&
            !message.isDeleted &&
            // Only group if less than 5 minutes apart
            new Date(message.createdAt).getTime() -
              new Date(prevMessage.createdAt).getTime() <
              5 * 60 * 1000;
          const isMostRecentOwnUserMessage =
            Boolean(currentUserId) &&
            message.authorType === "USER" &&
            message.id === latestOwnUserMessageId;
          if (isMostRecentOwnUserMessage) {
            isGrouped = false;
          }

          const showDivider = index === dividerIndex;

          // Use StreamingMessage for active/recently-completed streaming messages
          if (message.type === "STREAMING") {
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                data-message-author-type={message.authorType}
                data-message-type={message.type}
              >
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
          const typedTypes = [
            "TOOL_CALL",
            "TOOL_RESULT",
            "CODE_BLOCK",
            "ARTIFACT",
            "STATUS",
          ];
          if (typedTypes.includes(message.type)) {
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                data-message-author-type={message.authorType}
                data-message-type={message.type}
              >
                {showDivider && <UnreadDivider />}
                <TypedMessageItem message={message} isGrouped={isGrouped} />
              </div>
            );
          }

          return (
            <div
              key={message.id}
              data-message-id={message.id}
              data-message-author-type={message.authorType}
              data-message-type={message.type}
            >
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
