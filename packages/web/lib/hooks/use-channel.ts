"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { Channel, Socket } from "phoenix";
import { Presence } from "phoenix";
import { getSocket } from "@/lib/socket";
import { compareSequences } from "@/lib/api-safety";

export interface ReactionData {
  emoji: string;
  count: number;
  userIds: string[];
}

// TASK-0018: Tool call/result tracking for display
export interface ToolCallData {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResultData {
  callId: string;
  toolName: string;
  content: string;
  isError: boolean;
  timestamp: string;
}

export interface MessagePayload {
  id: string;
  channelId: string;
  authorId: string;
  authorType: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  type: string;
  streamingStatus: string | null;
  thinkingPhase?: string;
  thinkingTimeline?: Array<{ phase: string; timestamp: string }>; // TASK-0011
  metadata?: Record<string, unknown> | null; // Agent execution metadata: model, tokens, latency (TASK-0039)
  tokenHistory?: Array<{ o: number; t: number }>;
  checkpoints?: Array<{
    index: number;
    label: string;
    contentOffset: number;
    timestamp: string;
  }>; // TASK-0021
  toolCalls?: ToolCallData[]; // TASK-0018: active tool calls
  toolResults?: ToolResultData[]; // TASK-0018: completed tool results
  sequence: string;
  createdAt: string;
  reactions: ReactionData[];
  editedAt?: string | null;
  isDeleted?: boolean;
}

export interface TypingUser {
  userId: string;
  username: string;
  displayName: string;
}

export interface PresenceUser {
  userId: string;
  username: string;
  displayName: string;
  status: string;
}

// TASK-0020: Charter/swarm state for live header display
export interface CharterState {
  swarmMode: string;
  currentTurn: number;
  maxTurns: number;
  status: string; // "INACTIVE" | "ACTIVE" | "PAUSED" | "COMPLETED"
}

interface UseChannelReturn {
  messages: MessagePayload[];
  agentTriggerHint: string | null;
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, content: string) => Promise<boolean>;
  deleteMessage: (messageId: string) => Promise<boolean>;
  loadHistory: () => void;
  updateReactions: (messageId: string, reactions: ReactionData[]) => void;
  hasMoreHistory: boolean;
  isConnected: boolean;
  hasJoinedOnce: boolean;
  typingUsers: TypingUser[];
  sendTyping: () => void;
  presenceMap: Map<string, PresenceUser>;
  activeStreamCount: number; // TASK-0012: number of concurrently streaming messages
  charterState: CharterState | null; // TASK-0020: live charter status
  sendCharterControl: (action: "pause" | "end") => void; // TASK-0020
}

// ---------------------------------------------------------------------------
// Handler registration helpers — extracted from the monolithic useEffect
// Each function registers a group of related channel event handlers and
// keeps the main effect body as a concise orchestrator.
// ---------------------------------------------------------------------------

interface HandlerDeps {
  mounted: () => boolean;
  channelId: string;
  addMessages: (msgs: MessagePayload[], prepend?: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<MessagePayload[]>>;
  setAgentTriggerHint: React.Dispatch<React.SetStateAction<string | null>>;
  setTypingUsers: React.Dispatch<React.SetStateAction<TypingUser[]>>;
  setCharterState: React.Dispatch<React.SetStateAction<CharterState | null>>;
  setHasMoreHistory: React.Dispatch<React.SetStateAction<boolean>>;
  loadingHistoryRef: React.MutableRefObject<boolean>;
  pendingStreamMetaRef: React.MutableRefObject<
    Map<
      string,
      {
        agentId: string;
        agentName: string;
        agentAvatarUrl: string | null;
        sequence: string;
      }
    >
  >;
  streamLastTokenRef: React.MutableRefObject<Map<string, number>>;
  streamBufferRef: React.MutableRefObject<Map<string, string>>;
  typingTimersRef: React.MutableRefObject<Map<string, NodeJS.Timeout>>;
  lastSequenceRef: React.MutableRefObject<string>;
  messageIdsRef: React.MutableRefObject<Set<string>>;
  flushStreamBuffer: () => void;
}

function registerMessageHandlers(channel: Channel, deps: HandlerDeps) {
  channel.on("message_new", (raw: unknown) => {
    if (!deps.mounted()) return;
    deps.addMessages([raw as MessagePayload]);
  });

  channel.on("sync_response", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as { messages: MessagePayload[]; hasMore: boolean };
    if (payload.messages.length > 0) deps.addMessages(payload.messages);
  });

  channel.on("history_response", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as { messages: MessagePayload[]; hasMore: boolean };
    deps.loadingHistoryRef.current = false;
    deps.setHasMoreHistory(payload.hasMore);
    if (payload.messages.length > 0) deps.addMessages(payload.messages, true);
  });

  channel.on("typed_message", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as MessagePayload;
    deps.addMessages([{ ...payload, reactions: payload.reactions || [] }]);
  });

  channel.on("agent_trigger_skipped", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      agentId: string;
      agentName: string;
      reason: string;
      triggerMode: string;
    };
    if (payload.reason === "mention_required" && payload.agentName) {
      deps.setAgentTriggerHint(
        `Action needed: no agent triggered. Mention @${payload.agentName} to trigger it.`,
      );
    }
  });
}

function registerTypingHandlers(channel: Channel, deps: HandlerDeps) {
  channel.on("user_typing", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as TypingUser;

    deps.setTypingUsers((prev) => {
      const existing = prev.find((t) => t.userId === payload.userId);
      return existing ? prev : [...prev, payload];
    });

    const existingTimer = deps.typingTimersRef.current.get(payload.userId);
    if (existingTimer) clearTimeout(existingTimer);
    deps.typingTimersRef.current.set(
      payload.userId,
      setTimeout(() => {
        if (!deps.mounted()) return;
        deps.setTypingUsers((prev) =>
          prev.filter((t) => t.userId !== payload.userId),
        );
        deps.typingTimersRef.current.delete(payload.userId);
      }, 3000),
    );
  });
}

// ---------------------------------------------------------------------------
// Pure helpers for streaming message updates — extracted for readability and
// independent testability (low_level_elegance review issue).
// ---------------------------------------------------------------------------

/** Apply a stream_complete payload to a single message. */
export function applyStreamComplete(
  msg: MessagePayload,
  payload: {
    messageId: string;
    finalContent: string;
    thinkingTimeline?: Array<{ phase: string; timestamp: string }>;
    metadata?: Record<string, unknown>;
  },
): MessagePayload {
  if (msg.id !== payload.messageId) return msg;
  return {
    ...msg,
    content: payload.finalContent,
    streamingStatus: "COMPLETE",
    type: "STREAMING",
    thinkingPhase: undefined,
    thinkingTimeline: payload.thinkingTimeline || msg.thinkingTimeline,
    metadata: payload.metadata || msg.metadata,
  };
}

/** Apply a stream_error payload to an existing message. */
export function applyStreamError(
  msg: MessagePayload,
  payload: { messageId: string; error: string; partialContent: string | null },
): MessagePayload {
  if (msg.id !== payload.messageId) return msg;
  return {
    ...msg,
    content:
      payload.partialContent || msg.content || `[Error: ${payload.error}]`,
    type: "STREAMING",
    streamingStatus: "ERROR",
    thinkingPhase: undefined,
  };
}

/** Apply a stream_thinking payload to a single message. */
export function applyStreamThinking(
  msg: MessagePayload,
  payload: { messageId: string; phase: string; timestamp?: string },
): MessagePayload {
  if (msg.id !== payload.messageId) return msg;
  return {
    ...msg,
    thinkingPhase: payload.phase,
    thinkingTimeline: [
      ...(msg.thinkingTimeline || []),
      {
        phase: payload.phase,
        timestamp: payload.timestamp || new Date().toISOString(),
      },
    ],
  };
}

/** Apply a stream_tool_call payload to a single message. */
export function applyStreamToolCall(
  msg: MessagePayload,
  payload: {
    messageId: string;
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    timestamp: string;
  },
): MessagePayload {
  if (msg.id !== payload.messageId) return msg;
  return {
    ...msg,
    thinkingPhase: `Using ${payload.toolName}`,
    toolCalls: [
      ...(msg.toolCalls || []),
      {
        callId: payload.callId,
        toolName: payload.toolName,
        arguments: payload.arguments,
        timestamp: payload.timestamp,
      },
    ],
  };
}

/** Apply a stream_tool_result payload to a single message. */
export function applyStreamToolResult(
  msg: MessagePayload,
  payload: {
    messageId: string;
    callId: string;
    toolName: string;
    content: string;
    isError: boolean;
    timestamp: string;
  },
): MessagePayload {
  if (msg.id !== payload.messageId) return msg;
  return {
    ...msg,
    toolResults: [
      ...(msg.toolResults || []),
      {
        callId: payload.callId,
        toolName: payload.toolName,
        content: payload.content,
        isError: payload.isError,
        timestamp: payload.timestamp,
      },
    ],
  };
}

/** Build a fallback error message when stream_error arrives with no matching message. */
export function buildStreamErrorFallback(
  channelId: string,
  payload: { messageId: string; error: string; partialContent: string | null },
  streamMeta:
    | {
        agentId: string;
        agentName: string;
        agentAvatarUrl: string | null;
        sequence: string;
      }
    | undefined,
  lastSequence: string,
): MessagePayload {
  return {
    id: payload.messageId,
    channelId,
    authorId: streamMeta?.agentId || "",
    authorType: "AGENT",
    authorName: streamMeta?.agentName || "Agent",
    authorAvatarUrl: streamMeta?.agentAvatarUrl || null,
    content: payload.partialContent || `[Error: ${payload.error}]`,
    type: "STREAMING",
    streamingStatus: "ERROR",
    sequence: streamMeta?.sequence || lastSequence,
    createdAt: new Date().toISOString(),
    reactions: [],
  };
}

function registerStreamingHandlers(channel: Channel, deps: HandlerDeps) {
  channel.on("stream_start", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      agentId: string;
      agentName: string;
      agentAvatarUrl: string | null;
      sequence: string;
    };

    deps.pendingStreamMetaRef.current.set(payload.messageId, {
      agentId: payload.agentId,
      agentName: payload.agentName,
      agentAvatarUrl: payload.agentAvatarUrl,
      sequence: payload.sequence,
    });
    deps.streamLastTokenRef.current.set(payload.messageId, Date.now());

    const placeholder: MessagePayload = {
      id: payload.messageId,
      channelId: deps.channelId,
      authorId: payload.agentId,
      authorType: "AGENT",
      authorName: payload.agentName,
      authorAvatarUrl: payload.agentAvatarUrl,
      content: "",
      type: "STREAMING",
      streamingStatus: "ACTIVE",
      sequence: payload.sequence,
      createdAt: new Date().toISOString(),
      reactions: [],
    };
    deps.addMessages([placeholder]);
  });

  channel.on("stream_token", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as { messageId: string; token: string; index: number };
    deps.streamLastTokenRef.current.set(payload.messageId, Date.now());
    const existing = deps.streamBufferRef.current.get(payload.messageId) || "";
    deps.streamBufferRef.current.set(
      payload.messageId,
      existing + payload.token,
    );
    deps.flushStreamBuffer();
  });

  channel.on("stream_complete", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      finalContent: string;
      thinkingTimeline?: Array<{ phase: string; timestamp: string }>;
      metadata?: Record<string, unknown>;
    };
    deps.pendingStreamMetaRef.current.delete(payload.messageId);
    deps.streamLastTokenRef.current.delete(payload.messageId);
    deps.setMessages((prev) =>
      prev.map((m) => applyStreamComplete(m, payload)),
    );
    deps.streamBufferRef.current.delete(payload.messageId);
  });

  channel.on("stream_error", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      error: string;
      partialContent: string | null;
    };
    deps.streamLastTokenRef.current.delete(payload.messageId);
    deps.setMessages((prev) => {
      const hasMatch = prev.some((m) => m.id === payload.messageId);
      const streamMeta = deps.pendingStreamMetaRef.current.get(
        payload.messageId,
      );

      if (hasMatch) {
        deps.pendingStreamMetaRef.current.delete(payload.messageId);
        return prev.map((m) => applyStreamError(m, payload));
      }

      const fallback = buildStreamErrorFallback(
        deps.channelId,
        payload,
        streamMeta,
        deps.lastSequenceRef.current,
      );
      deps.messageIdsRef.current.add(payload.messageId);
      deps.pendingStreamMetaRef.current.delete(payload.messageId);
      return [...prev, fallback].sort((a, b) =>
        compareSequences(a.sequence, b.sequence),
      );
    });
    deps.streamBufferRef.current.delete(payload.messageId);
    const errorText = (payload.error || "").trim();
    if (errorText)
      deps.setAgentTriggerHint(`Agent response failed: ${errorText}`);
  });

  channel.on("stream_thinking", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      phase: string;
      timestamp?: string;
    };
    deps.setMessages((prev) =>
      prev.map((m) => applyStreamThinking(m, payload)),
    );
  });

  channel.on("stream_tool_call", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      callId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      timestamp: string;
    };
    deps.setMessages((prev) =>
      prev.map((m) => applyStreamToolCall(m, payload)),
    );
  });

  channel.on("stream_tool_result", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      callId: string;
      toolName: string;
      content: string;
      isError: boolean;
      timestamp: string;
    };
    deps.setMessages((prev) =>
      prev.map((m) => applyStreamToolResult(m, payload)),
    );
  });

  channel.on("stream_checkpoint", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      index: number;
      label: string;
      contentOffset: number;
      timestamp: string;
    };
    deps.setMessages((prev) =>
      prev.map((m) =>
        m.id === payload.messageId
          ? {
              ...m,
              checkpoints: [
                ...(m.checkpoints || []),
                {
                  index: payload.index,
                  label: payload.label,
                  contentOffset: payload.contentOffset,
                  timestamp: payload.timestamp,
                },
              ],
            }
          : m,
      ),
    );
  });
}

function registerMutationHandlers(channel: Channel, deps: HandlerDeps) {
  channel.on("reaction_update", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as { messageId: string; reactions: ReactionData[] };
    deps.setMessages((prev) =>
      prev.map((m) =>
        m.id === payload.messageId
          ? { ...m, reactions: payload.reactions || [] }
          : m,
      ),
    );
  });

  channel.on("charter_status", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      channelId: string;
      currentTurn: number;
      maxTurns: number;
      status: string;
      swarmMode?: string;
    };
    deps.setCharterState((prev) => ({
      swarmMode: payload.swarmMode || prev?.swarmMode || "HUMAN_IN_THE_LOOP",
      currentTurn: payload.currentTurn,
      maxTurns: payload.maxTurns,
      status: payload.status,
    }));
  });

  channel.on("message_edited", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as {
      messageId: string;
      content: string;
      editedAt: string;
    };
    deps.setMessages((prev) =>
      prev.map((m) =>
        m.id === payload.messageId
          ? { ...m, content: payload.content, editedAt: payload.editedAt }
          : m,
      ),
    );
  });

  channel.on("message_deleted", (raw: unknown) => {
    if (!deps.mounted()) return;
    const payload = raw as { messageId: string; deletedBy: string };
    deps.setMessages((prev) =>
      prev.map((m) =>
        m.id === payload.messageId ? { ...m, isDeleted: true } : m,
      ),
    );
  });
}

/**
 * Hook that manages a Phoenix Channel subscription for a chat room.
 * Handles messages, typing, presence, history, and reconnection sync.
 */
export function useChannel(channelId: string | null): UseChannelReturn {
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [agentTriggerHint, setAgentTriggerHint] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [hasJoinedOnce, setHasJoinedOnce] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceUser>>(
    new Map(),
  );
  const [charterState, setCharterState] = useState<CharterState | null>(null); // TASK-0020

  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastSequenceRef = useRef<string>("0");
  const messageIdsRef = useRef<Set<string>>(new Set());
  const pendingStreamMetaRef = useRef<
    Map<
      string,
      {
        agentId: string;
        agentName: string;
        agentAvatarUrl: string | null;
        sequence: string;
      }
    >
  >(new Map());
  const typingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastTypingSentRef = useRef<number>(0);
  const loadingHistoryRef = useRef(false);
  const agentHintTimerRef = useRef<NodeJS.Timeout | null>(null);

  // BUG-006: Track last token timestamp per streaming message for timeout detection
  const streamLastTokenRef = useRef<Map<string, number>>(new Map());
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Streaming: accumulate tokens and flush via rAF for smooth 60fps rendering
  const streamBufferRef = useRef<Map<string, string>>(new Map());
  const rafRef = useRef<number | null>(null);

  // Add messages with deduplication
  const addMessages = useCallback(
    (newMessages: MessagePayload[], prepend = false) => {
      setMessages((prev) => {
        const normalizedNew = newMessages.map((message) => ({
          ...message,
          reactions: message.reactions || [],
        }));
        const uniqueNew = normalizedNew.filter(
          (m) => !messageIdsRef.current.has(m.id),
        );
        if (uniqueNew.length === 0) return prev;

        uniqueNew.forEach((m) => messageIdsRef.current.add(m.id));

        // Update lastSequence
        for (const m of uniqueNew) {
          if (compareSequences(m.sequence, lastSequenceRef.current) > 0) {
            lastSequenceRef.current = m.sequence;
          }
        }

        const merged = prepend
          ? [...uniqueNew, ...prev]
          : [...prev, ...uniqueNew];
        return merged.sort((a, b) => compareSequences(a.sequence, b.sequence));
      });
    },
    [],
  );

  // Flush accumulated stream tokens into message state (max 60fps via rAF)
  const flushStreamBuffer = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const buffer = streamBufferRef.current;
      if (buffer.size === 0) return;

      // Snapshot and clear
      const updates = new Map(buffer);
      buffer.clear();

      setMessages((prev) =>
        prev.map((m) => {
          const newContent = updates.get(m.id);
          if (newContent !== undefined) {
            return { ...m, content: m.content + newContent };
          }
          return m;
        }),
      );
    });
  }, []);

  // Connect and join channel
  useEffect(() => {
    if (!channelId) return;

    let mounted = true;

    // Reset state for new channel
    setMessages([]);
    setAgentTriggerHint(null);
    setHasMoreHistory(true);
    setIsConnected(false);
    setHasJoinedOnce(false);
    setTypingUsers([]);
    setPresenceMap(new Map());
    messageIdsRef.current = new Set();
    pendingStreamMetaRef.current = new Map();
    lastSequenceRef.current = "0";
    loadingHistoryRef.current = false;
    if (agentHintTimerRef.current) {
      clearTimeout(agentHintTimerRef.current);
      agentHintTimerRef.current = null;
    }

    async function joinChannel() {
      const socket = await getSocket();
      if (!socket || !mounted) return;
      socketRef.current = socket;

      // Leave previous channel if any
      if (channelRef.current) {
        channelRef.current.leave();
      }

      // Join new channel with lastSequence for reconnection sync
      const channel = socket.channel(`room:${channelId}`, {
        lastSequence:
          lastSequenceRef.current !== "0" ? lastSequenceRef.current : undefined,
      });

      channel.onError(() => {
        setIsConnected(false);
      });

      channel.onClose(() => {
        setIsConnected(false);
      });

      // Set up presence
      const presence = new Presence(channel);
      presence.onSync(() => {
        if (!mounted) return;
        const newMap = new Map<string, PresenceUser>();
        presence.list((userId: string, presenceData: unknown) => {
          const data = presenceData as { metas: Array<Record<string, string>> };
          const meta = data?.metas?.[0];
          if (meta) {
            newMap.set(userId, {
              userId,
              username: meta.username || "",
              displayName: meta.display_name || "",
              status: meta.status || "online",
            });
          }
        });
        setPresenceMap(newMap);
      });

      // Register all channel event handlers (extracted for readability)
      const deps: HandlerDeps = {
        mounted: () => mounted,
        channelId: channelId!,
        addMessages,
        setMessages,
        setAgentTriggerHint,
        setTypingUsers,
        setCharterState,
        setHasMoreHistory,
        loadingHistoryRef,
        pendingStreamMetaRef,
        streamLastTokenRef,
        streamBufferRef,
        typingTimersRef,
        lastSequenceRef,
        messageIdsRef,
        flushStreamBuffer,
      };

      registerMessageHandlers(channel, deps);
      registerTypingHandlers(channel, deps);
      registerStreamingHandlers(channel, deps);
      registerMutationHandlers(channel, deps);

      channel
        .join()
        .receive("ok", () => {
          if (!mounted) return;
          setIsConnected(true);
          setHasJoinedOnce(true);
          channelRef.current = channel;

          // Load initial history if no sync was triggered
          if (lastSequenceRef.current === "0") {
            channel.push("history", { limit: 50 });
          }
        })
        .receive("error", (resp: unknown) => {
          console.error("[Channel] Join error:", resp);
        });
    }

    joinChannel();

    // BUG-006: Periodic check for stale ACTIVE streams (lost stream_complete events)
    const STREAM_TIMEOUT_MS = 60_000; // 60s — well above Go Proxy's 30s per-token timeout
    const streamTimeoutInterval = setInterval(() => {
      if (!mounted) return;
      const now = Date.now();
      const expired: string[] = [];

      streamLastTokenRef.current.forEach((lastToken, messageId) => {
        if (now - lastToken > STREAM_TIMEOUT_MS) {
          expired.push(messageId);
        }
      });

      if (expired.length > 0) {
        expired.forEach((id) => streamLastTokenRef.current.delete(id));
        setMessages((prev) =>
          prev.map((m) =>
            expired.includes(m.id) && m.streamingStatus === "ACTIVE"
              ? {
                  ...m,
                  streamingStatus: "ERROR",
                  content: m.content || "[Stream timed out]",
                }
              : m,
          ),
        );
      }
    }, 10_000); // Check every 10 seconds
    streamTimeoutRef.current = streamTimeoutInterval;

    const typingTimers = typingTimersRef.current;
    const streamBuffer = streamBufferRef.current;

    return () => {
      mounted = false;
      if (channelRef.current) {
        channelRef.current.leave();
        channelRef.current = null;
      }
      // Clear typing timers
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
      // Clear stream buffer and cancel rAF
      streamBuffer.clear();
      // BUG-006: Clear stream timeout interval
      clearInterval(streamTimeoutInterval);
      streamLastTokenRef.current.clear();
      if (agentHintTimerRef.current) {
        clearTimeout(agentHintTimerRef.current);
        agentHintTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [channelId, addMessages, flushStreamBuffer]);

  // Send a message
  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    if (!channelRef.current) {
      setAgentTriggerHint(
        "Action needed: disconnected from channel gateway. Reconnecting...",
      );
      return;
    }

    setAgentTriggerHint(null);
    channelRef.current.push("new_message", { content: trimmed });
  }, []);

  // Load older messages (history)
  const loadHistory = useCallback(() => {
    if (!channelRef.current || !hasMoreHistory || loadingHistoryRef.current)
      return;

    loadingHistoryRef.current = true;
    const oldestMessage = messages[0];
    channelRef.current.push("history", {
      before: oldestMessage?.id,
      limit: 50,
    });
  }, [hasMoreHistory, messages]);

  const updateReactions = useCallback(
    (messageId: string, reactions: ReactionData[]) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, reactions } : message,
        ),
      );
    },
    [],
  );

  // Send typing indicator (debounced, 3s cooldown)
  const sendTyping = useCallback(() => {
    if (!channelRef.current) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    channelRef.current.push("typing", {});
  }, []);

  // Edit a message (TASK-0014)
  const editMessage = useCallback(
    (messageId: string, content: string): Promise<boolean> => {
      return new Promise((resolve) => {
        if (!channelRef.current) {
          resolve(false);
          return;
        }
        channelRef.current
          .push("message_edit", { messageId, content })
          .receive("ok", () => resolve(true))
          .receive("error", (resp: unknown) => {
            console.error("[Channel] Edit error:", resp);
            resolve(false);
          })
          .receive("timeout", () => {
            console.error("[Channel] Edit timeout");
            resolve(false);
          });
      });
    },
    [],
  );

  // Delete a message (TASK-0014)
  const deleteMessage = useCallback((messageId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!channelRef.current) {
        resolve(false);
        return;
      }
      channelRef.current
        .push("message_delete", { messageId })
        .receive("ok", () => resolve(true))
        .receive("error", (resp: unknown) => {
          console.error("[Channel] Delete error:", resp);
          resolve(false);
        })
        .receive("timeout", () => {
          console.error("[Channel] Delete timeout");
          resolve(false);
        });
    });
  }, []);

  // TASK-0012: count concurrently active streams
  const activeStreamCount = useMemo(
    () => messages.filter((m) => m.streamingStatus === "ACTIVE").length,
    [messages],
  );

  // TASK-0020: Send charter control action (pause/end)
  const sendCharterControl = useCallback((action: "pause" | "end") => {
    if (!channelRef.current) return;
    channelRef.current.push("charter_control", { action });
  }, []);

  return {
    messages,
    agentTriggerHint,
    sendMessage,
    editMessage,
    deleteMessage,
    loadHistory,
    updateReactions,
    hasMoreHistory,
    isConnected,
    hasJoinedOnce,
    typingUsers,
    sendTyping,
    presenceMap,
    activeStreamCount,
    charterState,
    sendCharterControl,
  };
}
