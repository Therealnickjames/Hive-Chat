"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface UnreadState {
  hasUnread: boolean;
  mentionCount: number;
  /** Sequence number of last message the user has read in this channel */
  lastReadSeq: string;
}

export interface UseUnreadReturn {
  /** Map of channelId → { hasUnread, mentionCount } */
  unreadMap: Map<string, UnreadState>;
  /** Mark a channel as read (optimistic + server call) */
  markAsRead: (channelId: string) => void;
  /** Force-refresh unread state from server */
  refreshUnread: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Hook to track unread state for all channels in a server.
 * Fetches on mount and serverId change, polls every 30s. (TASK-0016)
 */
export function useUnread(serverId: string | null): UseUnreadReturn {
  const [unreadMap, setUnreadMap] = useState<Map<string, UnreadState>>(
    new Map()
  );
  const serverIdRef = useRef(serverId);
  serverIdRef.current = serverId;

  const fetchUnread = useCallback(async () => {
    const sid = serverIdRef.current;
    if (!sid) {
      setUnreadMap(new Map());
      return;
    }

    try {
      const res = await fetch(`/api/servers/${sid}/unread`);
      if (!res.ok) return;
      const data = await res.json();
      const channels: { channelId: string; hasUnread: boolean; mentionCount: number; lastReadSeq: string }[] =
        data.channels || [];

      // Only update if we're still looking at the same server
      if (serverIdRef.current !== sid) return;

      const nextMap = new Map<string, UnreadState>();
      for (const ch of channels) {
        nextMap.set(ch.channelId, {
          hasUnread: ch.hasUnread,
          mentionCount: ch.mentionCount,
          lastReadSeq: ch.lastReadSeq ?? "0",
        });
      }
      setUnreadMap(nextMap);
    } catch (error) {
      console.error("[useUnread] Failed to fetch unread state:", error);
    }
  }, []);

  const markAsRead = useCallback(
    (channelId: string) => {
      const sid = serverIdRef.current;
      if (!sid) return;

      // Optimistic: clear unread + mentions immediately.
      // Set lastReadSeq to a very large sentinel so the divider doesn't reappear
      // for new messages arriving before the next 30s poll syncs the real value.
      setUnreadMap((prev) => {
        const next = new Map(prev);
        next.set(channelId, {
          hasUnread: false,
          mentionCount: 0,
          lastReadSeq: "9999999999999999999",
        });
        return next;
      });

      // Fire-and-forget server call
      fetch(`/api/servers/${sid}/channels/${channelId}/read`, {
        method: "POST",
      }).catch((err) => {
        console.error("[useUnread] Failed to mark as read:", err);
      });
    },
    []
  );

  // Fetch on mount and when serverId changes
  useEffect(() => {
    if (!serverId) {
      setUnreadMap(new Map());
      return;
    }
    void fetchUnread();
  }, [serverId, fetchUnread]);

  // Poll every 30s
  useEffect(() => {
    if (!serverId) return;
    const interval = setInterval(() => {
      void fetchUnread();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [serverId, fetchUnread]);

  return { unreadMap, markAsRead, refreshUnread: fetchUnread };
}
