"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * TASK-0019: DM conversation list item.
 * Maps to API response from GET /api/dms
 */
export interface DmConversation {
  id: string;
  otherUser: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  lastMessage: {
    content: string;
    createdAt: string;
    isOwn: boolean;
  } | null;
  updatedAt: string;
}

interface UseDmListReturn {
  conversations: DmConversation[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  startDm: (userId: string) => Promise<string | null>;
}

/**
 * Hook that fetches and manages the user's DM conversation list.
 * (TASK-0019)
 */
export function useDmList(): UseDmListReturn {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dms");
      if (res.ok) {
        const data = await res.json();
        // API returns { dms: [{ id, participant, lastMessage, updatedAt }] }
        const dmItems = data.dms || [];
        const mapped: DmConversation[] = dmItems
          .filter((dm: { participant: unknown }) => dm.participant != null)
          .map((dm: {
            id: string;
            participant: { id: string; username: string; displayName: string; avatarUrl: string | null };
            lastMessage: { content: string; createdAt: string; isOwn: boolean } | null;
            updatedAt: string;
          }) => ({
            id: dm.id,
            otherUser: dm.participant,
            lastMessage: dm.lastMessage,
            updatedAt: dm.updatedAt,
          }));
        setConversations(mapped);
      }
    } catch (error) {
      console.error("[useDmList] Failed to fetch DMs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Start or get a DM with another user
  const startDm = useCallback(async (userId: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (res.ok) {
        const data = await res.json();
        // API returns { dm: { id, participant, isNew } }
        await refresh();
        return data.dm?.id || null;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("[useDmList] Failed to start DM:", errData.error);
        return null;
      }
    } catch (error) {
      console.error("[useDmList] Failed to start DM:", error);
      return null;
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    conversations,
    isLoading,
    refresh,
    startDm,
  };
}
