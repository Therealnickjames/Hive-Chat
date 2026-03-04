"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Channel, Socket } from "phoenix";
import { Presence } from "phoenix";
import { getSocket } from "@/lib/socket";

/**
 * TASK-0019: DM message payload (simplified — no streaming, no bots).
 */
export interface DmMessagePayload {
  id: string;
  dmId: string;
  authorId: string;
  authorType: "USER";
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  type: string;
  sequence: string;
  createdAt: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
}

function compareSequences(a: string, b: string): number {
  const aBigInt = BigInt(a);
  const bBigInt = BigInt(b);
  if (aBigInt === bBigInt) return 0;
  return aBigInt > bBigInt ? 1 : -1;
}

export interface DmTypingUser {
  userId: string;
  username: string;
  displayName: string;
}

export interface DmPresenceUser {
  userId: string;
  username: string;
  displayName: string;
  status: string;
}

interface UseDmChannelReturn {
  messages: DmMessagePayload[];
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, content: string) => Promise<boolean>;
  deleteMessage: (messageId: string) => Promise<boolean>;
  loadHistory: () => void;
  hasMoreHistory: boolean;
  isConnected: boolean;
  typingUsers: DmTypingUser[];
  sendTyping: () => void;
  presenceMap: Map<string, DmPresenceUser>;
}

/**
 * Hook that manages a Phoenix Channel subscription for a DM conversation.
 * Topic: "dm:{dmId}"
 *
 * Handles messages, typing, presence, history, and reconnection sync.
 * No streaming/bot support — DMs are human-only. (TASK-0019)
 */
export function useDmChannel(dmId: string | null): UseDmChannelReturn {
  const [messages, setMessages] = useState<DmMessagePayload[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<DmTypingUser[]>([]);
  const [presenceMap, setPresenceMap] = useState<Map<string, DmPresenceUser>>(
    new Map(),
  );

  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastSequenceRef = useRef<string>("0");
  const messageIdsRef = useRef<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastTypingSentRef = useRef<number>(0);
  const loadingHistoryRef = useRef(false);

  // Add messages with deduplication
  const addMessages = useCallback(
    (newMessages: DmMessagePayload[], prepend = false) => {
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

  // Connect and join channel
  useEffect(() => {
    if (!dmId) return;

    let mounted = true;

    // Reset state for new DM
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

      // Join DM channel with lastSequence for reconnection sync
      const channel = socket.channel(`dm:${dmId}`, {
        lastSequence:
          lastSequenceRef.current !== "0" ? lastSequenceRef.current : undefined,
      });

      // Set up presence
      const presence = new Presence(channel);
      presence.onSync(() => {
        if (!mounted) return;
        const newMap = new Map<string, DmPresenceUser>();
        presence.list((userId: string, presenceData: unknown) => {
          const data = presenceData as {
            metas: Array<Record<string, string>>;
          };
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
        const payload = raw as DmMessagePayload;
        addMessages([payload]);
      });

      // Listen for sync messages (reconnection)
      channel.on("sync_messages", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as { messages: DmMessagePayload[] };
        if (payload.messages.length > 0) {
          addMessages(payload.messages);
        }
      });

      // Listen for typing indicators
      channel.on("typing", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as DmTypingUser;

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
              prev.filter((t) => t.userId !== payload.userId),
            );
            typingTimersRef.current.delete(payload.userId);
          }, 3000),
        );
      });

      // Listen for message edits
      channel.on("message_edited", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          content: string;
          editedAt: string;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, content: payload.content, editedAt: payload.editedAt }
              : m,
          ),
        );
      });

      // Listen for message deletes
      channel.on("message_deleted", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          deletedBy: string;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId ? { ...m, isDeleted: true } : m,
          ),
        );
      });

      // Listen for reaction updates (TASK-0030)
      channel.on("reaction_update", (raw: unknown) => {
        if (!mounted) return;
        const payload = raw as {
          messageId: string;
          reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, reactions: payload.reactions || [] }
              : m,
          ),
        );
      });

      channel
        .join()
        .receive("ok", () => {
          if (!mounted) return;
          setIsConnected(true);
          channelRef.current = channel;

          // Load initial history
          if (lastSequenceRef.current === "0") {
            channel
              .push("history", { limit: 50 })
              .receive("ok", (resp: unknown) => {
                if (!mounted) return;
                const data = resp as {
                  messages: DmMessagePayload[];
                  hasMore: boolean;
                };
                setHasMoreHistory(data.hasMore);
                if (data.messages.length > 0) {
                  addMessages(data.messages);
                }
              });
          }
        })
        .receive("error", (resp: unknown) => {
          console.error("[DmChannel] Join error:", resp);
        });
    }

    joinChannel();

    const typingTimers = typingTimersRef.current;

    return () => {
      mounted = false;
      if (channelRef.current) {
        channelRef.current.leave();
        channelRef.current = null;
      }
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
    };
  }, [dmId, addMessages]);

  // Send a message
  const sendMessage = useCallback((content: string) => {
    if (!channelRef.current || !content.trim()) return;
    channelRef.current.push("new_message", { content: content.trim() });
  }, []);

  // Load older messages (history)
  const loadHistory = useCallback(() => {
    if (!channelRef.current || !hasMoreHistory || loadingHistoryRef.current)
      return;

    loadingHistoryRef.current = true;
    const oldestMessage = messages[0];
    channelRef.current
      .push("history", {
        before: oldestMessage?.id,
        limit: 50,
      })
      .receive("ok", (resp: unknown) => {
        loadingHistoryRef.current = false;
        const data = resp as {
          messages: DmMessagePayload[];
          hasMore: boolean;
        };
        setHasMoreHistory(data.hasMore);
        if (data.messages.length > 0) {
          addMessages(data.messages, true);
        }
      })
      .receive("error", () => {
        loadingHistoryRef.current = false;
      });
  }, [hasMoreHistory, messages, addMessages]);

  // Send typing indicator (debounced, 3s cooldown)
  const sendTyping = useCallback(() => {
    if (!channelRef.current) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    channelRef.current.push("typing", {});
  }, []);

  // Edit a message
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
            console.error("[DmChannel] Edit error:", resp);
            resolve(false);
          })
          .receive("timeout", () => {
            console.error("[DmChannel] Edit timeout");
            resolve(false);
          });
      });
    },
    [],
  );

  // Delete a message
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
          console.error("[DmChannel] Delete error:", resp);
          resolve(false);
        })
        .receive("timeout", () => {
          console.error("[DmChannel] Delete timeout");
          resolve(false);
        });
    });
  }, []);

  return {
    messages,
    sendMessage,
    editMessage,
    deleteMessage,
    loadHistory,
    hasMoreHistory,
    isConnected,
    typingUsers,
    sendTyping,
    presenceMap,
  };
}
