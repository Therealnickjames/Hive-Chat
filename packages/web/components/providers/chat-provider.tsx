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
  refreshServers: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshBots: () => Promise<void>;
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
  const [currentServerName, setCurrentServerName] = useState<string | null>(
    null
  );
  const [currentServerOwnerId, setCurrentServerOwnerId] = useState<
    string | null
  >(null);

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
        setChannels(data.channels || []);
        setCurrentServerName(data.name || null);
        setCurrentServerOwnerId(data.ownerId || null);
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
        setMembers(data.members || []);
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
        setBots((data.bots || []).filter((b: BotData) => b.isActive));
      }
    } catch (error) {
      console.error("Failed to fetch bots:", error);
    }
  }, [serverId]);

  // Fetch servers on mount
  useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  // Fetch channels and members when serverId changes
  useEffect(() => {
    refreshChannels();
    refreshMembers();
    refreshBots();
  }, [refreshChannels, refreshMembers, refreshBots]);

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
        refreshServers,
        refreshChannels,
        refreshMembers,
        refreshBots,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
