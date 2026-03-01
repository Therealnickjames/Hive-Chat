"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { hasPermission as hasPermissionBit } from "@/lib/permissions";
import { useUnread } from "@/lib/hooks/use-unread";
import type { UnreadState } from "@/lib/hooks/use-unread";

interface ServerData {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
}

interface ChannelData {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  position: number;
  defaultBotId: string | null;
  botIds?: string[];
}

interface MemberData {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface BotData {
  id: string;
  name: string;
  isActive: boolean;
  llmModel?: string;
  thinkingSteps?: string | null; // JSON array of phase labels
}

interface ServerScopedData {
  channels: ChannelData[];
  members: MemberData[];
  bots: BotData[];
}

interface ChatContextValue {
  servers: ServerData[];
  currentServerId: string | null;
  currentChannelId: string | null;
  currentServerName: string | null;
  currentServerOwnerId: string | null;
  channels: ChannelData[];
  members: MemberData[];
  bots: BotData[];
  serverDataById: Record<string, ServerScopedData>;
  refreshServers: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshBots: () => Promise<void>;
  ensureServerScopedData: (serverId: string) => Promise<void>;
  refreshServerScopedData: (serverId: string) => Promise<void>;
  userPermissions: bigint;
  isOwner: boolean;
  hasPermission: (permission: bigint) => boolean;
  /** TASK-0016: unread state per channel */
  unreadMap: Map<string, UnreadState>;
  markAsRead: (channelId: string) => void;
  refreshUnread: () => Promise<void>;
  /** TASK-0016: aggregate unread per server (for server sidebar dots) */
  serverUnreadMap: Map<string, { hasUnread: boolean; hasMentions: boolean }>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}

/**
 * Parse serverId and channelId from the URL pathname.
 * Expected pattern: /servers/{serverId}/channels/{channelId}
 */
function parsePathIds(pathname: string) {
  const match = pathname.match(
    /\/servers\/([^/]+)(?:\/channels\/([^/]+))?/
  );
  return {
    serverId: match?.[1] || null,
    channelId: match?.[2] || null,
  };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { serverId, channelId } = parsePathIds(pathname);

  const [servers, setServers] = useState<ServerData[]>([]);
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [bots, setBots] = useState<BotData[]>([]);
  const [serverDataById, setServerDataById] = useState<
    Record<string, ServerScopedData>
  >({});
  const [currentServerName, setCurrentServerName] = useState<string | null>(
    null
  );
  const [currentServerOwnerId, setCurrentServerOwnerId] = useState<
    string | null
  >(null);
  const [userPermissions, setUserPermissions] = useState<bigint>(BigInt(0));
  const [isOwner, setIsOwner] = useState(false);

  const refreshServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch (error) {
      console.error("Failed to fetch servers:", error);
    }
  }, []);

  const refreshChannels = useCallback(async () => {
    if (!serverId) {
      setChannels([]);
      setBots([]);
      setCurrentServerName(null);
      setCurrentServerOwnerId(null);
      return;
    }
    try {
      const res = await fetch(`/api/servers/${serverId}`);
      if (res.ok) {
        const data = await res.json();
        const nextChannels = data.channels || [];
        setChannels(nextChannels);
        setCurrentServerName(data.name || null);
        setCurrentServerOwnerId(data.ownerId || null);
        setServerDataById((prev) => ({
          ...prev,
          [serverId]: {
            channels: nextChannels,
            members: prev[serverId]?.members || [],
            bots: prev[serverId]?.bots || [],
          },
        }));
      }
    } catch (error) {
      console.error("Failed to fetch channels:", error);
    }
  }, [serverId]);

  const refreshMembers = useCallback(async () => {
    if (!serverId) {
      setMembers([]);
      return;
    }
    try {
      const res = await fetch(`/api/servers/${serverId}/members`);
      if (res.ok) {
        const data = await res.json();
        const nextMembers = data.members || [];
        setMembers(nextMembers);
        setServerDataById((prev) => ({
          ...prev,
          [serverId]: {
            channels: prev[serverId]?.channels || [],
            members: nextMembers,
            bots: prev[serverId]?.bots || [],
          },
        }));
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
    }
  }, [serverId]);

  const refreshBots = useCallback(async () => {
    if (!serverId) {
      setBots([]);
      return;
    }
    try {
      const res = await fetch(`/api/servers/${serverId}/bots`);
      if (res.ok) {
        const data = await res.json();
        const nextBots = (data.bots || []).filter((b: BotData) => b.isActive);
        setBots(nextBots);
        setServerDataById((prev) => ({
          ...prev,
          [serverId]: {
            channels: prev[serverId]?.channels || [],
            members: prev[serverId]?.members || [],
            bots: nextBots,
          },
        }));
      }
    } catch (error) {
      console.error("Failed to fetch bots:", error);
    }
  }, [serverId]);

  const refreshPermissions = useCallback(async () => {
    if (!serverId) {
      setUserPermissions(BigInt(0));
      setIsOwner(false);
      return;
    }

    try {
      const res = await fetch(`/api/servers/${serverId}/permissions`);
      if (res.ok) {
        const data = await res.json();
        setUserPermissions(BigInt(data.permissions || "0"));
        setIsOwner(!!data.isOwner);
      } else {
        setUserPermissions(BigInt(0));
        setIsOwner(false);
      }
    } catch (error) {
      console.error("Failed to fetch permissions:", error);
      setUserPermissions(BigInt(0));
      setIsOwner(false);
    }
  }, [serverId]);

  const hasPermission = useCallback(
    (permission: bigint) => {
      if (isOwner) return true;
      return hasPermissionBit(userPermissions, permission);
    },
    [userPermissions, isOwner]
  );

  // TASK-0016: Unread state for all channels in the current server
  const { unreadMap, markAsRead: markAsReadHook, refreshUnread } = useUnread(serverId);

  // TASK-0016: Aggregate unread per server (for server sidebar dots)
  const [serverUnreadMap, setServerUnreadMap] = useState<
    Map<string, { hasUnread: boolean; hasMentions: boolean }>
  >(new Map());

  const refreshAllServerUnreads = useCallback(async (
    serverList: ServerData[],
    skipServerId: string | null
  ) => {
    if (serverList.length === 0) return;
    try {
      // Skip the current server — useUnread already fetches it
      const toFetch = serverList.filter((s) => s.id !== skipServerId);
      const results = await Promise.allSettled(
        toFetch.map(async (s) => {
          const res = await fetch(`/api/servers/${s.id}/unread`);
          if (!res.ok) return { serverId: s.id, hasUnread: false, hasMentions: false };
          const data = await res.json();
          const channels: { hasUnread: boolean; mentionCount: number }[] = data.channels || [];
          return {
            serverId: s.id,
            hasUnread: channels.some((c) => c.hasUnread),
            hasMentions: channels.some((c) => c.mentionCount > 0),
          };
        })
      );
      setServerUnreadMap((prev) => {
        const nextMap = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled") {
            nextMap.set(r.value.serverId, {
              hasUnread: r.value.hasUnread,
              hasMentions: r.value.hasMentions,
            });
          }
        }
        return nextMap;
      });
    } catch (error) {
      console.error("[ChatProvider] Failed to fetch server unreads:", error);
    }
  }, []);

  // Wrapper that also optimistically updates serverUnreadMap when marking a channel read
  const markAsRead = useCallback(
    (channelId: string) => {
      markAsReadHook(channelId);

      // Also optimistically re-evaluate the current server's aggregate unread state.
      // After marking this channel read, check if any OTHER channel still has unreads.
      if (serverId) {
        setServerUnreadMap((prev) => {
          const next = new Map(prev);
          // Check if there are still other unread channels in this server
          let stillHasUnread = false;
          let stillHasMentions = false;
          for (const [cid, state] of unreadMap) {
            if (cid === channelId) continue; // this one is being marked read
            if (state.hasUnread) stillHasUnread = true;
            if (state.mentionCount > 0) stillHasMentions = true;
          }
          next.set(serverId, { hasUnread: stillHasUnread, hasMentions: stillHasMentions });
          return next;
        });
      }
    },
    [markAsReadHook, serverId, unreadMap]
  );

  const refreshServerScopedData = useCallback(async (targetServerId: string) => {
    if (!targetServerId) return;

    try {
      const [serverRes, membersRes, botsRes] = await Promise.all([
        fetch(`/api/servers/${targetServerId}`),
        fetch(`/api/servers/${targetServerId}/members`),
        fetch(`/api/servers/${targetServerId}/bots`),
      ]);

      if (!serverRes.ok) return;

      const serverJson = await serverRes.json();
      const membersJson = membersRes.ok ? await membersRes.json() : { members: [] };
      const botsJson = botsRes.ok ? await botsRes.json() : { bots: [] };

      setServerDataById((prev) => ({
        ...prev,
        [targetServerId]: {
          channels: serverJson.channels || [],
          members: membersJson.members || [],
          bots: (botsJson.bots || []).filter((b: BotData) => b.isActive),
        },
      }));
    } catch (error) {
      console.error("Failed to refresh server scoped data:", error);
    }
  }, []);

  const ensureServerScopedData = useCallback(
    async (targetServerId: string) => {
      if (!targetServerId) return;
      if (serverDataById[targetServerId]) return;
      await refreshServerScopedData(targetServerId);
    },
    [serverDataById, refreshServerScopedData]
  );

  // Fetch servers on mount
  useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  // TASK-0016: Derive current server's aggregate unread from the channel-level unreadMap
  // (which is already kept fresh by useUnread) instead of double-fetching.
  useEffect(() => {
    if (!serverId || unreadMap.size === 0) return;
    let hasUnread = false;
    let hasMentions = false;
    for (const state of unreadMap.values()) {
      if (state.hasUnread) hasUnread = true;
      if (state.mentionCount > 0) hasMentions = true;
    }
    setServerUnreadMap((prev) => {
      const next = new Map(prev);
      next.set(serverId, { hasUnread, hasMentions });
      return next;
    });
  }, [serverId, unreadMap]);

  // TASK-0016: Fetch server-level unreads when server list changes + poll every 30s
  useEffect(() => {
    if (servers.length === 0) return;
    void refreshAllServerUnreads(servers, serverId);
    const interval = setInterval(() => {
      void refreshAllServerUnreads(servers, serverId);
    }, 30_000);
    return () => clearInterval(interval);
  }, [servers, serverId, refreshAllServerUnreads]);

  // Fetch channels and members when serverId changes
  useEffect(() => {
    refreshChannels();
    refreshMembers();
    refreshBots();
    refreshPermissions();
  }, [refreshChannels, refreshMembers, refreshBots, refreshPermissions]);

  return (
    <ChatContext.Provider
      value={{
        servers,
        currentServerId: serverId,
        currentChannelId: channelId,
        currentServerName,
        currentServerOwnerId,
        channels,
        members,
        bots,
        serverDataById,
        refreshServers,
        refreshChannels,
        refreshMembers,
        refreshBots,
        ensureServerScopedData,
        refreshServerScopedData,
        userPermissions,
        isOwner,
        hasPermission,
        unreadMap,
        markAsRead,
        refreshUnread,
        serverUnreadMap,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
