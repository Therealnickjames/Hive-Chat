"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MessageItem } from "./message-item";
import { StreamingMessage } from "./streaming-message";
import { TypedMessageItem } from "./typed-message-item";
import { UnreadDivider } from "./unread-divider";

const TYPED_MESSAGE_TYPES = [
  "TOOL_CALL",
  "TOOL_RESULT",
  "CODE_BLOCK",
  "ARTIFACT",
  "STATUS",
];

function MessageRow({
  message,
  prevMessage,
  showDivider,
  currentUserId,
  latestOwnUserMessageId,
  onReactionsChange,
  onResumeStream,
  canManageMessages,
  onEditMessage,
  onDeleteMessage,
  isHighlighted,
}: {
  message: MessagePayload;
  prevMessage?: MessagePayload;
  showDivider: boolean;
  currentUserId?: string;
  latestOwnUserMessageId: string | null;
  onReactionsChange: (messageId: string, reactions: ReactionData[]) => void;
  onResumeStream?: (
    messageId: string,
    checkpointIndex: number,
    agentId: string,
  ) => void;
  canManageMessages?: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => void;
  isHighlighted?: boolean;
}) {
  let isGrouped =
    prevMessage?.authorId === message.authorId &&
    prevMessage?.authorType === message.authorType &&
    !prevMessage?.isDeleted &&
    !message.isDeleted &&
    new Date(message.createdAt).getTime() -
      new Date(prevMessage!.createdAt).getTime() <
      5 * 60 * 1000;

  if (
    currentUserId &&
    message.authorType === "USER" &&
    message.id === latestOwnUserMessageId
  ) {
    isGrouped = false;
  }

  const wrapper = (children: React.ReactNode) => (
    <div
      data-message-id={message.id}
      data-message-author-type={message.authorType}
      data-message-type={message.type}
      className={
        isHighlighted
          ? "rounded transition-colors duration-1000 bg-accent-cyan/15"
          : undefined
      }
    >
      {showDivider && <UnreadDivider />}
      {children}
    </div>
  );

  if (message.type === "STREAMING") {
    return wrapper(
      <StreamingMessage
        message={message}
        isGrouped={isGrouped}
        onReactionsChange={onReactionsChange}
        onResumeStream={onResumeStream}
        currentUserId={currentUserId}
        canManageMessages={canManageMessages}
        onDelete={onDeleteMessage}
      />,
    );
  }

  if (TYPED_MESSAGE_TYPES.includes(message.type)) {
    return wrapper(
      <TypedMessageItem message={message} isGrouped={isGrouped} />,
    );
  }

  return wrapper(
    <MessageItem
      message={message}
      isGrouped={isGrouped}
      onReactionsChange={onReactionsChange}
      currentUserId={currentUserId}
      canManageMessages={canManageMessages}
      onEdit={onEditMessage}
      onDelete={onDeleteMessage}
    />,
  );
}

interface MessageListProps {
  messages: MessagePayload[];
  hasMoreHistory: boolean;
  onLoadHistory: () => void;
  onReactionsChange: (messageId: string, reactions: ReactionData[]) => void;
  currentUserId?: string;
  canManageMessages?: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => void;
  /** TASK-0021: callback to resume a stream from a checkpoint */
  onResumeStream?: (
    messageId: string,
    checkpointIndex: number,
    agentId: string,
  ) => void;
  /** TASK-0016: sequence of last message the user has read (for divider placement) */
  lastReadSeq?: string | null;
  /** TASK-0012: number of concurrently active streams */
  activeStreamCount?: number;
  /** Whether the channel has agents assigned (for empty state messaging) */
  hasAgents?: boolean;
  /** TASK-0022: scroll to and highlight this message */
  scrollToMessageId?: string | null;
  /** TASK-0022: callback when scroll-to animation completes */
  onScrollToMessageComplete?: () => void;
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
  onResumeStream,
  lastReadSeq,
  activeStreamCount = 0,
  hasAgents = false,
  scrollToMessageId,
  onScrollToMessageComplete,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const hasSeededSeenMessageIdsRef = useRef(false);
  const prioritizedIncomingUserMessageIdRef = useRef<string | null>(null);
  // TASK-0022: Highlighted message for search jump
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
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

  const dividerIndex = useMemo(() => {
    if (!lastReadSeq || lastReadSeq === "0" || messages.length === 0) return -1;
    const lrs = BigInt(lastReadSeq);
    for (let i = 0; i < messages.length; i++) {
      try {
        if (BigInt(messages[i].sequence) > lrs) {
          // If dividerIndex is 0 (all messages unread), don't show
          return i > 0 ? i : -1;
        }
      } catch {
        // skip if sequence isn't a valid bigint
      }
    }
    return -1;
  }, [messages, lastReadSeq]);

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

  // TASK-0022: Scroll to and highlight a specific message (search jump)
  useEffect(() => {
    if (!scrollToMessageId) return;
    const el = containerRef.current;
    if (!el) return;

    const target = el.querySelector<HTMLElement>(
      `[data-message-id="${scrollToMessageId}"]`,
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(scrollToMessageId);
      // Clear highlight after animation
      const timeout = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 2000);
      onScrollToMessageComplete?.();
      return () => clearTimeout(timeout);
    }
    onScrollToMessageComplete?.();
  }, [scrollToMessageId, onScrollToMessageComplete]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-1 pb-4 pt-3"
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

      {/* Empty state — agent-aware messaging */}
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center px-4 py-10">
          <div className="chrome-card rounded-lg px-8 py-10 text-center">
            {hasAgents ? (
              <>
                <p className="font-display text-xl font-semibold text-white">
                  Agents are ready
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  Send a message to get started!
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-xl font-semibold text-white">
                  No messages yet
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  Be the first to send a message!
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* TASK-0012: Active streams indicator for multi-agent channels */}
      {activeStreamCount > 1 && (
        <div className="sticky top-0 z-10 flex justify-center py-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-cyan/[0.06] px-3 py-1 text-[10px] font-medium text-accent-cyan">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
            {activeStreamCount} agents responding
          </span>
        </div>
      )}

      {/* TASK-0016: Compute divider position — the index of the FIRST unread message */}
      {messages.map((message, index) => (
        <MessageRow
          key={message.id}
          message={message}
          prevMessage={messages[index - 1]}
          showDivider={index === dividerIndex}
          currentUserId={currentUserId}
          latestOwnUserMessageId={latestOwnUserMessageId}
          onReactionsChange={onReactionsChange}
          onResumeStream={onResumeStream}
          canManageMessages={canManageMessages}
          onEditMessage={onEditMessage}
          onDeleteMessage={onDeleteMessage}
          isHighlighted={message.id === highlightedMessageId}
        />
      ))}
    </div>
  );
}
