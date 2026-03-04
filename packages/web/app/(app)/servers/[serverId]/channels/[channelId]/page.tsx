"use client";

import { Workspace } from "@/components/workspace/workspace";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { useChatContext } from "@/components/providers/chat-provider";

export default function ChannelPage() {
  const params = useParams<{ serverId: string; channelId: string }>();
  const { openPanel } = useWorkspaceContext();
  const { channels, servers } = useChatContext();

  useEffect(() => {
    if (params.channelId && channels.length > 0 && servers.length > 0) {
      const channel = channels.find((c) => c.id === params.channelId);
      const server = servers.find((s) => s.id === params.serverId);
      if (channel && server) {
        openPanel({
          channelId: channel.id,
          channelName: channel.name,
          serverId: server.id,
          serverName: server.name,
        });
      }
    }
  }, [params.channelId, params.serverId, channels, servers, openPanel]);

  return <Workspace />;
}
