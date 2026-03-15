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
import {
  Plus,
  Hash,
  Server as ServerIcon,
  MessageSquare,
  Settings2,
  Compass,
} from "lucide-react";
import { UserProfileButton } from "@/components/user/user-profile-button";
import { ServerSettingsOverlay } from "@/components/server-settings/server-settings-overlay";

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
    unreadMap,
  } = useChatContext();
  const { openPanel, panels, activeStreams } = useWorkspaceContext();
  const [activeTab, setActiveTab] = useState<
    "servers" | "channels" | "messages"
  >(pathname.startsWith("/dms") ? "messages" : "channels");
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);

  const { conversations: dmConversations, isLoading: dmsLoading } = useDmList();
  const activeDmId = pathname.match(/\/dms\/([^/]+)/)?.[1] || null;
  const openChannelIds = new Set(
    panels.filter((p) => !p.isClosed).map((p) => p.channelId),
  );

  return (
    <>
      <div className="chrome-panel flex h-full flex-col overflow-hidden">
        <div className="px-3 pb-2 pt-3">
          <div
            role="tablist"
            className="grid h-[36px] grid-cols-3 gap-1 rounded-md bg-background-primary/60 p-0.5"
          >
            <button
              role="tab"
              aria-selected={activeTab === "servers"}
              onClick={() => setActiveTab("servers")}
              className={`flex items-center justify-center gap-1.5 rounded text-[10px] font-semibold tracking-[0.1em] transition-all ${
                activeTab === "servers"
                  ? "bg-brand/8 text-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <ServerIcon className="h-3 w-3" />
              SERVERS
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "channels"}
              onClick={() => setActiveTab("channels")}
              className={`flex items-center justify-center gap-1.5 rounded text-[10px] font-semibold tracking-[0.1em] transition-all ${
                activeTab === "channels"
                  ? "bg-brand/8 text-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Hash className="h-3 w-3" />
              CHANNELS
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "messages"}
              onClick={() => setActiveTab("messages")}
              className={`flex items-center justify-center gap-1.5 rounded text-[10px] font-semibold tracking-[0.1em] transition-all ${
                activeTab === "messages"
                  ? "bg-brand/8 text-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              DMs
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {activeTab === "servers" ? (
            <div className="space-y-0.5">
              {servers.map((server) => {
                const isActive = currentServerId === server.id;
                return (
                  <button
                    key={server.id}
                    onClick={() => {
                      router.push(`/servers/${server.id}`);
                      setActiveTab("channels");
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[12px] font-medium transition-all ${
                      isActive
                        ? "bg-brand/6 text-text-primary"
                        : "text-text-muted hover:bg-white/[0.02] hover:text-text-secondary"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background-floating text-[11px] font-bold text-text-secondary">
                      {server.iconUrl ? (
                        <Image
                          src={server.iconUrl}
                          alt=""
                          loader={passthroughImageLoader}
                          unoptimized
                          width={32}
                          height={32}
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
              <div className="mt-3 pt-2">
                <button
                  onClick={() => setShowCreateServer(true)}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[12px] font-medium text-text-dim transition-all hover:bg-white/[0.02] hover:text-text-muted"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-white/6 bg-background-primary/60">
                    <Plus className="h-3.5 w-3.5" />
                  </div>
                  <span>New Server</span>
                </button>
                <button
                  onClick={() => router.push("/discover")}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[12px] font-medium text-text-dim transition-all hover:bg-white/[0.02] hover:text-text-muted"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-white/6 bg-background-primary/60">
                    <Compass className="h-3.5 w-3.5" />
                  </div>
                  <span>Discover</span>
                </button>
              </div>
            </div>
          ) : activeTab === "messages" ? (
            <div className="space-y-0.5">
              <div className="mb-2 flex items-center justify-between px-2.5">
                <span className="text-[10px] font-semibold tracking-[0.14em] text-text-dim">
                  DIRECT MESSAGES
                </span>
              </div>

              {dmsLoading ? (
                <div className="px-2.5 text-[11px] text-text-dim">
                  Loading...
                </div>
              ) : dmConversations.length === 0 ? (
                <div className="mx-2 rounded-md bg-background-primary/50 px-3 py-4 text-center text-[11px] text-text-dim">
                  No direct messages yet.
                  <span className="mt-1 block text-text-dim/60">
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
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] transition-all ${
                        isActive
                          ? "bg-brand/6 text-text-primary"
                          : "text-text-muted hover:bg-white/[0.02] hover:text-text-secondary"
                      }`}
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-background-floating text-[11px] font-bold text-text-secondary">
                        {dm.otherUser.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium">
                          {dm.otherUser.displayName}
                        </div>
                        {dm.lastMessage && (
                          <div className="mt-0.5 truncate text-[11px] text-text-dim">
                            {dm.lastMessage.content}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div>
              {currentServerId ? (
                <div>
                  <div className="mb-2 flex items-center justify-between px-2.5">
                    <span className="truncate pr-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-dim">
                      {currentServerName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {hasPermission(Permissions.MANAGE_CHANNELS) && (
                        <button
                          onClick={() => setShowCreateChannel(true)}
                          className="rounded p-1.5 text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                          title="Create Channel"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                      {(isOwner ||
                        hasPermission(Permissions.MANAGE_SERVER)) && (
                        <button
                          onClick={() => setShowServerSettings(true)}
                          className="rounded p-1.5 text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                          title="Server Settings"
                          data-testid="server-settings-btn"
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {channels.map((channel) => {
                      const isOpen = openChannelIds.has(channel.id);
                      const isStreaming = activeStreams.has(channel.id);
                      const unread = unreadMap?.get(channel.id);
                      const hasUnread = !isOpen && !!unread?.hasUnread;
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
                              `/servers/${currentServerId}/channels/${channel.id}`,
                            );
                          }}
                          className={`group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all ${
                            isOpen
                              ? "bg-brand/6 text-text-primary"
                              : hasUnread
                                ? "text-text-primary hover:bg-white/[0.02]"
                                : "text-text-muted hover:bg-white/[0.02] hover:text-text-secondary"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Hash
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isOpen
                                  ? "text-brand"
                                  : "text-text-dim group-hover:text-text-muted"
                              }`}
                            />
                            <span
                              className={`truncate ${hasUnread ? "font-semibold" : ""}`}
                            >
                              {channel.name}
                            </span>
                          </div>
                          {isStreaming && (
                            <span className="relative mr-0.5 flex h-2 w-2 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-cyan shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {channels.length === 0 && (
                      <div className="px-2.5 pt-2 text-[11px] text-text-dim">
                        No channels found
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-2 rounded-md bg-background-primary/50 px-3 py-6 text-center text-[12px] text-text-dim">
                  <ServerIcon className="mx-auto mb-2 h-6 w-6 text-text-dim/60" />
                  Select a server from the{" "}
                  <span className="font-medium text-text-muted">SERVERS</span>{" "}
                  tab to view channels.
                </div>
              )}
            </div>
          )}
        </div>

        <UserProfileButton />
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

      {currentServerId && (
        <ServerSettingsOverlay
          serverId={currentServerId}
          serverName={currentServerName || ""}
          isOwner={isOwner}
          isOpen={showServerSettings}
          onClose={() => setShowServerSettings(false)}
          onServerUpdated={refreshServers}
        />
      )}
    </>
  );
}
