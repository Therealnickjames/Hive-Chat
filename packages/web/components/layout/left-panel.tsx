"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useChatContext } from "@/components/providers/chat-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { CreateServerModal } from "@/components/modals/create-server-modal";
import { CreateChannelModal } from "@/components/modals/create-channel-modal";
import { Permissions } from "@/lib/permissions";
import { passthroughImageLoader } from "@/lib/image-loader";
import { useDmList } from "@/lib/hooks/use-dm-list";

export function LeftPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    servers,
    currentServerId,
    channels,
    currentServerName,
    isOwner,
    hasPermission,
    refreshServers,
  } = useChatContext();
  const { openPanel, panels, activeStreams, removePanelsForServer } =
    useWorkspaceContext();
  const [activeTab, setActiveTab] = useState<"servers" | "channels" | "messages">(
    pathname.startsWith("/dms") ? "messages" : "channels"
  );
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  // TASK-0019: DM conversations list
  const { conversations: dmConversations, isLoading: dmsLoading } = useDmList();

  // Derive active DM from URL
  const activeDmId = pathname.match(/\/dms\/([^/]+)/)?.[1] || null;

  // Derive which channels have active panels
  const openChannelIds = new Set(
    panels.filter((p) => !p.isClosed).map((p) => p.channelId)
  );

  async function handleDeleteCurrentServer() {
    if (!currentServerId || !isOwner) return;
    const confirmed = window.confirm(
      "Delete this server permanently? This will remove all channels, messages, and agents in the server."
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/servers/${currentServerId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete server");
        return;
      }
      removePanelsForServer(currentServerId);
      await refreshServers();
      router.push("/");
    } catch {
      alert("Failed to delete server");
    }
  }

  return (
    <>
      <div className="flex flex-col border-r border-border bg-background-primary h-full">
        {/* Tabs */}
        <div className="flex border-b border-border bg-background-secondary h-[38px] shrink-0">
          <button
            onClick={() => setActiveTab("servers")}
            className={`flex-1 p-2 text-center text-xs font-mono transition-colors ${
              activeTab === "servers"
                ? "border-b-2 border-brand text-brand"
                : "text-text-dim hover:text-text-secondary"
            }`}
          >
            SERVERS
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            className={`flex-1 p-2 text-center text-xs font-mono transition-colors ${
              activeTab === "channels"
                ? "border-b-2 border-brand text-brand"
                : "text-text-dim hover:text-text-secondary"
            }`}
          >
            CHANNELS
          </button>
          <button
            onClick={() => setActiveTab("messages")}
            className={`flex-1 p-2 text-center text-xs font-mono transition-colors ${
              activeTab === "messages"
                ? "border-b-2 border-brand text-brand"
                : "text-text-dim hover:text-text-secondary"
            }`}
          >
            DMs
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {activeTab === "servers" ? (
            <div className="space-y-1">
              {servers.map((server) => {
                const isActive = currentServerId === server.id;
                return (
                  <button
                    key={server.id}
                    onClick={() => {
                      router.push(`/servers/${server.id}`);
                      setActiveTab("channels");
                    }}
                    className={`flex w-full items-center gap-3 rounded p-2 text-sm transition-all ${
                      isActive
                        ? "bg-brand/10 border-r-2 border-brand text-brand"
                        : "text-text-secondary hover:bg-background-secondary"
                    }`}
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background-secondary text-xs font-bold font-sans overflow-hidden">
                      {server.iconUrl ? (
                        <Image
                          src={server.iconUrl}
                          alt=""
                          loader={passthroughImageLoader}
                          unoptimized
                          width={24}
                          height={24}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        server.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span className="truncate">{server.name}</span>
                  </button>
                );
              })}
              <button
                onClick={() => setShowCreateServer(true)}
                className="mt-4 flex w-full items-center gap-3 rounded p-2 text-sm text-status-online hover:bg-background-secondary transition-all"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background-secondary text-xs font-bold border border-status-online">
                  +
                </div>
                <span>New Server</span>
              </button>
            </div>
          ) : activeTab === "messages" ? (
            /* TASK-0019: DM Conversations List */
            <div className="space-y-1">
              <div className="mb-2 px-2">
                <span className="text-[10px] font-bold uppercase text-text-dim tracking-wider">
                  Direct Messages
                </span>
              </div>

              {dmsLoading ? (
                <div className="px-2 text-xs text-text-dim">Loading...</div>
              ) : dmConversations.length === 0 ? (
                <div className="px-2 text-xs text-text-dim text-center mt-4">
                  No direct messages yet.
                  <br />
                  <span className="text-text-muted">
                    Click a member to start a conversation.
                  </span>
                </div>
              ) : (
                dmConversations.map((dm) => {
                  const isActive = activeDmId === dm.id;
                  return (
                    <button
                      key={dm.id}
                      onClick={() => router.push(`/dms/${dm.id}`)}
                      className={`flex w-full items-center gap-2.5 rounded px-2 py-2 text-xs transition-colors ${
                        isActive
                          ? "bg-background-secondary text-text-primary"
                          : "text-text-secondary hover:bg-background-secondary hover:text-text-primary"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-background-tertiary text-xs font-semibold text-text-primary">
                        {dm.otherUser.displayName.charAt(0).toUpperCase()}
                      </div>
                      {/* Name + preview */}
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium font-mono">
                          {dm.otherUser.displayName}
                        </div>
                        {dm.lastMessage && (
                          <div className="truncate text-[10px] text-text-dim mt-0.5">
                            {dm.lastMessage.content.slice(0, 50)}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {currentServerId ? (
                <div>
                  <div className="mb-2 flex items-center justify-between px-2">
                    <span className="text-[10px] font-bold uppercase text-text-dim tracking-wider">
                      {currentServerName}
                    </span>
                    <div className="flex items-center gap-2">
                      {hasPermission(Permissions.MANAGE_CHANNELS) && (
                        <button
                          onClick={() => setShowCreateChannel(true)}
                          className="text-text-dim hover:text-text-primary"
                          title="Create Channel"
                        >
                          +
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {channels.map((channel) => {
                      const isOpen = openChannelIds.has(channel.id);
                      const isStreaming = activeStreams.has(channel.id);
                      return (
                        <button
                          key={channel.id}
                          onClick={() => {
                            openPanel({
                              channelId: channel.id,
                              channelName: channel.name,
                              serverId: currentServerId,
                              serverName: currentServerName || "",
                            });
                            router.replace(
                              `/servers/${currentServerId}/channels/${channel.id}`
                            );
                          }}
                          className={`group flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                            isOpen
                              ? "bg-background-secondary text-text-primary"
                              : "text-text-secondary hover:bg-background-secondary hover:text-text-primary"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-text-dim font-mono">#</span>
                            <span className="truncate font-mono">{channel.name}</span>
                          </div>
                          {isStreaming && (
                            <span className="relative flex h-1.5 w-1.5 mr-1">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-cyan opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-cyan"></span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {channels.length === 0 && (
                      <div className="px-2 text-xs text-text-dim">No channels found</div>
                    )}
                  </div>
                  {isOwner && (
                    <div className="mt-3 border-t border-border pt-3 px-2">
                      <button
                        onClick={handleDeleteCurrentServer}
                        className="w-full rounded border border-status-dnd/30 bg-status-dnd/10 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-status-dnd transition hover:bg-status-dnd/20"
                      >
                        Delete Server
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-2 text-xs text-text-dim text-center mt-10">
                  Select a server from the SERVERS tab first.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CreateServerModal
        isOpen={showCreateServer}
        onClose={() => setShowCreateServer(false)}
      />

      {currentServerId && (
        <CreateChannelModal
          isOpen={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

    </>
  );
}
