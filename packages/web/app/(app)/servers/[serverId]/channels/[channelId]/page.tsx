"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useChatContext } from "@/components/providers/chat-provider";
import { ChatArea } from "@/components/chat/chat-area";
import { MemberList } from "@/components/layout/member-list";
import type { PresenceUser } from "@/lib/hooks/use-channel";

export default function ChannelPage() {
  const params = useParams<{ serverId: string; channelId: string }>();
  const { channels } = useChatContext();
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceUser>>(
    new Map()
  );

  const channel = channels.find((c) => c.id === params.channelId);
  const channelName = channel?.name || "loading";
  const channelTopic = channel?.topic || null;

  const handlePresenceChange = useCallback(
    (newPresence: Map<string, PresenceUser>) => {
      setPresenceMap(newPresence);
    },
    []
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      <ChatArea
        channelId={params.channelId}
        channelName={channelName}
        channelTopic={channelTopic}
        onPresenceChange={handlePresenceChange}
      />
      <MemberList presenceMap={presenceMap} />
    </div>
  );
}
