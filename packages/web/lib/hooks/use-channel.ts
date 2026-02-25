"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Channel, Socket } from "phoenix";
import { Presence } from "phoenix";
import { getSocket } from "@/lib/socket";

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
  sequence: string;
  createdAt: string;
}

function compareSequences(a: string, b: string): number {
  const aBigInt = BigInt(a);
  const bBigInt = BigInt(b);
  if (aBigInt === bBigInt) return 0;
  return aBigInt > bBigInt ? 1 : -1;
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

interface UseChannelReturn {
  messages: MessagePayload[];
  sendMessage: (content: string) => void;
  loadHistory: () => void;
  hasMoreHistory: boolean;
  isConnected: boolean;
  typingUsers: TypingUser[];
  sendTyping: () => void;
  presenceMap: Map<string, PresenceUser>;
}

/**
 * Hook that manages a Phoenix Channel subscription for a chat room.
 * Handles messages, typing, presence, history, and reconnection sync.
 */
export function useChannel(channelId: string | null): UseChannelReturn {
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceUser>>(
    new Map()
  );

  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastSequenceRef = useRef<string>("0");
  const messageIdsRef = useRef<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastTypingSentRef = useRef<number>(0);
  const loadingHistoryRef = useRef(false);

  // Streaming: accumulate tokens and flush via rAF for smooth 60fps rendering
  const streamBufferRef = useRef<Map<string, string>>(new Map());
  const rafRef = useRef<number | null>(null);

  // Add messages with deduplication
  const addMessages = useCallback(
    (newMessages: MessagePayload[], prepend = false) => {
      setMessages((prev) => {
        const uniqueNew = newMessages.filter(
          (m) => !messageIdsRef.current.has(m.id)
        );
        if (uniqueNew.length === 0) return prev;

        uniqueNew.forEach((m) => messageIdsRef.current.add(m.id));

        // Update lastSequence
        for (const m of uniqueNew) {
          if (compareSequences(m.sequence, lastSequenceRef.current) > 0) {
            lastSequenceRef.current = m.sequence;
          }
        }

        const merged = prepend ? [...uniqueNew, ...prev] : [...prev, ...uniqueNew];
        return merged.sort((a, b) => compareSequences(a.sequence, b.sequence));
      });
    },
    []
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
        })
      );
    });
  }, []);

  // Connect and join channel
  useEffect(() => {
    if (!channelId) return;

    let mounted = true;

    // Reset state for new channel
    setMessages([]);
    setHasMoreHistory(true);
    setIsConnected(false);
    setTypingUsers([]);
    setPresenceMap(new Map());
    messageIdsRef.current = new Set();
    lastSequenceRef.current = "0";
    loadingHistoryRef.current = false;

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

      // Listen for new messages
      channel.on("message_new", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as MessagePayload;
        addMessages([payload]);
      });

      // Listen for sync responses (reconnection)
      channel.on("sync_response", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as { messages: MessagePayload[]; hasMore: boolean };
        if (payload.messages.length > 0) {
          addMessages(payload.messages);
        }
      });

      // Listen for history responses
      channel.on("history_response", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as { messages: MessagePayload[]; hasMore: boolean };
        loadingHistoryRef.current = false;
        setHasMoreHistory(payload.hasMore);
        if (payload.messages.length > 0) {
          addMessages(payload.messages, true);
        }
      });

      // Listen for typing indicators
      channel.on("user_typing", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as TypingUser;

        setTypingUsers((prev) => {
          const existing = prev.find((t) => t.userId === payload.userId);
          if (!existing) {
            return [...prev, payload];
          }
          return prev;
        });

        // Clear typing after 3 seconds
        const existingTimer = typingTimersRef.current.get(payload.userId);
        if (existingTimer) clearTimeout(existingTimer);
        typingTimersRef.current.set(
          payload.userId,
          setTimeout(() => {
            if (!mounted) return;
            setTypingUsers((prev) =>
              prev.filter((t) => t.userId !== payload.userId)
            );
            typingTimersRef.current.delete(payload.userId);
          }, 3000)
        );
      });

      // ---- Streaming events ----

      // stream_start: add placeholder message for the bot
      channel.on("stream_start", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          botId: string;
          botName: string;
          botAvatarUrl: string | null;
          sequence: string;
        };

        const placeholder: MessagePayload = {
          id: payload.messageId,
          channelId: channelId!,
          authorId: payload.botId,
          authorType: "BOT",
          authorName: payload.botName,
          authorAvatarUrl: payload.botAvatarUrl,
          content: "",
          type: "STREAMING",
          streamingStatus: "ACTIVE",
          sequence: payload.sequence,
          createdAt: new Date().toISOString(),
        };

        addMessages([placeholder]);
      });

      // stream_token: accumulate in buffer, flush via rAF
      channel.on("stream_token", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          token: string;
          index: number;
        };

        const existing = streamBufferRef.current.get(payload.messageId) || "";
        streamBufferRef.current.set(payload.messageId, existing + payload.token);
        flushStreamBuffer();
      });

      // stream_complete: set final content and mark COMPLETE
      channel.on("stream_complete", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          finalContent: string;
        };

        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  content: payload.finalContent,
                  streamingStatus: "COMPLETE",
                  type: "STREAMING",
                }
              : m
          )
        );

        // Clear any buffered tokens for this message
        streamBufferRef.current.delete(payload.messageId);
      });

      // stream_error: set partial content and mark ERROR
      channel.on("stream_error", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          error: string;
          partialContent: string | null;
        };

        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  content:
                    payload.partialContent || m.content || "[Error: " + payload.error + "]",
                  streamingStatus: "ERROR",
                }
              : m
          )
        );

        // Clear any buffered tokens for this message
        streamBufferRef.current.delete(payload.messageId);
      });

      channel
        .join()
        .receive("ok", () => {
          if (!mounted) return;
          setIsConnected(true);
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

    return () => {
      mounted = false;
      if (channelRef.current) {
        channelRef.current.leave();
        channelRef.current = null;
      }
      // Clear typing timers
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
      // Clear stream buffer and cancel rAF
      streamBufferRef.current.clear();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [channelId, addMessages, flushStreamBuffer]);

  // Send a message
  const sendMessage = useCallback(
    (content: string) => {
      if (!channelRef.current || !content.trim()) return;
      channelRef.current.push("new_message", { content: content.trim() });
    },
    []
  );

  // Load older messages (history)
  const loadHistory = useCallback(() => {
    if (
      !channelRef.current ||
      !hasMoreHistory ||
      loadingHistoryRef.current
    )
      return;

    loadingHistoryRef.current = true;
    const oldestMessage = messages[0];
    channelRef.current.push("history", {
      before: oldestMessage?.id,
      limit: 50,
    });
  }, [hasMoreHistory, messages]);

  // Send typing indicator (debounced, 3s cooldown)
  const sendTyping = useCallback(() => {
    if (!channelRef.current) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    channelRef.current.push("typing", {});
  }, []);

  return {
    messages,
    sendMessage,
    loadHistory,
    hasMoreHistory,
    isConnected,
    typingUsers,
    sendTyping,
    presenceMap,
  };
}
