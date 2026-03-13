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
      <div className="chrome-panel flex h-full flex-col rounded-lg overflow-hidden">
        <div className="border-b border-border/60 px-3 pb-3 pt-3">
          <div
            role="tablist"
            className="grid h-[44px] grid-cols-3 gap-1 rounded-lg border border-white/5 bg-background-tertiary/55 p-1"
          >
            <button
              role="tab"
              aria-selected={activeTab === "servers"}
              onClick={() => setActiveTab("servers")}
              className={`flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold tracking-[0.08em] transition-all ${
                activeTab === "servers"
                  ? "border border-brand/20 bg-brand/10 text-white "
                  : "text-text-muted hover:bg-background-floating/60 hover:text-text-primary"
              }`}
            >
              <ServerIcon className="h-3.5 w-3.5" />
              SERVERS
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "channels"}
              onClick={() => setActiveTab("channels")}
              className={`flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold tracking-[0.08em] transition-all ${
                activeTab === "channels"
                  ? "border border-brand/20 bg-brand/10 text-white "
                  : "text-text-muted hover:bg-background-floating/60 hover:text-text-primary"
              }`}
            >
              <Hash className="h-3.5 w-3.5" />
              CHANNELS
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "messages"}
              onClick={() => setActiveTab("messages")}
              className={`flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold tracking-[0.08em] transition-all ${
                activeTab === "messages"
                  ? "border border-brand/20 bg-brand/10 text-white "
                  : "text-text-muted hover:bg-background-floating/60 hover:text-text-primary"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              DMs
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-3">
          {activeTab === "servers" ? (
            <div className="space-y-1.5">
              {servers.map((server) => {
                const isActive = currentServerId === server.id;
                return (
                  <button
                    key={server.id}
                    onClick={() => {
                      router.push(`/servers/${server.id}`);
                      setActiveTab("channels");
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                      isActive
                        ? "border-brand/30 bg-brand/10 text-white "
                        : "border-transparent text-text-secondary hover:border-white/5 hover:bg-background-floating/55 hover:text-text-primary"
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-background-floating text-xs font-bold text-text-primary ">
                      {server.iconUrl ? (
                        <Image
                          src={server.iconUrl}
                          alt=""
                          loader={passthroughImageLoader}
                          unoptimized
                          width={36}
                          height={36}
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
              <div className="mt-3 border-t border-border/50 pt-3">
                <button
                  onClick={() => setShowCreateServer(true)}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-sm font-medium text-text-muted transition-all hover:border-brand/20 hover:bg-background-floating/45 hover:text-text-primary"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-current/50 bg-background-tertiary/60">
                    <Plus className="h-4 w-4" />
                  </div>
                  <span>New Server</span>
                </button>
              </div>
            </div>
          ) : activeTab === "messages" ? (
            <div className="space-y-1.5">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold tracking-[0.12em] text-text-muted">
                  DIRECT MESSAGES
                </span>
                <button className="rounded-lg p-1 text-text-muted hover:bg-background-floating/55 hover:text-text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {dmsLoading ? (
                <div className="px-2 text-xs text-text-muted">Loading...</div>
              ) : dmConversations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 bg-background-tertiary/45 px-3 py-5 text-center text-xs text-text-muted">
                  No direct messages yet.
                  <span className="mt-1 block text-text-dim">
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
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                        isActive
                          ? "border-brand/30 bg-brand/10 text-white "
                          : "border-transparent text-text-secondary hover:border-white/5 hover:bg-background-floating/55 hover:text-text-primary"
                      }`}
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-background-floating text-xs font-bold text-text-primary ">
                        {dm.otherUser.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium">
                          {dm.otherUser.displayName}
                        </div>
                        {dm.lastMessage && (
                          <div className="mt-0.5 truncate text-xs text-text-muted">
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
            <div className="space-y-4">
              {currentServerId ? (
                <div>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="truncate pr-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                      {currentServerName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {hasPermission(Permissions.MANAGE_CHANNELS) && (
                        <button
                          onClick={() => setShowCreateChannel(true)}
                          className="rounded-lg p-1 text-text-muted transition-colors hover:bg-background-floating/60 hover:text-text-primary"
                          title="Create Channel"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(isOwner ||
                        hasPermission(Permissions.MANAGE_SERVER)) && (
                        <button
                          onClick={() => setShowServerSettings(true)}
                          className="rounded-lg p-1 text-text-muted transition-colors hover:bg-background-floating/60 hover:text-text-primary"
                          title="Server Settings"
                          data-testid="server-settings-btn"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
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
                          className={`group flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                            isOpen
                              ? "border-brand/20 bg-brand/10 text-white "
                              : hasUnread
                                ? "border-transparent text-text-primary hover:border-white/5 hover:bg-background-floating/55"
                                : "border-transparent text-text-secondary hover:border-white/5 hover:bg-background-floating/55 hover:text-text-primary"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <Hash
                              className={`h-4 w-4 shrink-0 ${
                                isOpen
                                  ? "text-brand"
                                  : "text-text-muted group-hover:text-text-primary"
                              }`}
                            />
                            <span
                              className={`truncate ${hasUnread ? "font-semibold" : ""}`}
                            >
                              {channel.name}
                            </span>
                          </div>
                          {isStreaming && (
                            <span className="relative mr-1 flex h-2.5 w-2.5 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-75" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-green shadow-[0_0_14px_rgba(16,185,129,0.55)]" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {channels.length === 0 && (
                      <div className="px-2 pt-2 text-sm text-text-muted">
                        No channels found
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 bg-background-tertiary/45 px-4 py-8 text-center text-sm text-text-muted">
                  <ServerIcon className="mx-auto mb-3 h-8 w-8 text-text-dim" />
                  Select a server from the{" "}
                  <span className="font-semibold text-text-secondary">
                    SERVERS
                  </span>{" "}
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
