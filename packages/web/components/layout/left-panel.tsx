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
  } = useChatContext();
  const { openPanel, panels, activeStreams } = useWorkspaceContext();
  const [activeTab, setActiveTab] = useState<
    "servers" | "channels" | "messages"
  >(pathname.startsWith("/dms") ? "messages" : "channels");
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);

  // TASK-0019: DM conversations list
  const { conversations: dmConversations, isLoading: dmsLoading } = useDmList();

  // Derive active DM from URL
  const activeDmId = pathname.match(/\/dms\/([^/]+)/)?.[1] || null;

  // Derive which channels have active panels
  const openChannelIds = new Set(
    panels.filter((p) => !p.isClosed).map((p) => p.channelId),
  );

  return (
    <>
      <div className="flex flex-col border-r border-border bg-background-primary h-full">
        {/* Tabs */}
        <div
          role="tablist"
          className="flex border-b border-border bg-background-secondary h-[48px] p-1.5 shrink-0 gap-1"
        >
          <button
            role="tab"
            aria-selected={activeTab === "servers"}
            onClick={() => setActiveTab("servers")}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-all ${
              activeTab === "servers"
                ? "bg-brand/10 text-brand shadow-sm"
                : "text-text-muted hover:bg-background-floating hover:text-text-secondary"
            }`}
          >
            <ServerIcon className="h-3.5 w-3.5" />
            SERVERS
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "channels"}
            onClick={() => setActiveTab("channels")}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-all ${
              activeTab === "channels"
                ? "bg-brand/10 text-brand shadow-sm"
                : "text-text-muted hover:bg-background-floating hover:text-text-secondary"
            }`}
          >
            <Hash className="h-3.5 w-3.5" />
            CHANNELS
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "messages"}
            onClick={() => setActiveTab("messages")}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-all ${
              activeTab === "messages"
                ? "bg-brand/10 text-brand shadow-sm"
                : "text-text-muted hover:bg-background-floating hover:text-text-secondary"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            DMs
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
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
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-brand/10 text-brand"
                        : "text-text-secondary hover:bg-background-floating hover:text-text-primary"
                    }`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background-floating text-xs font-bold overflow-hidden shadow-sm">
                      {server.iconUrl ? (
                        <Image
                          src={server.iconUrl}
                          alt=""
                          loader={passthroughImageLoader}
                          unoptimized
                          width={28}
                          height={28}
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
              <div className="pt-2 mt-2 border-t border-border">
                <button
                  onClick={() => setShowCreateServer(true)}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-text-muted hover:bg-background-floating hover:text-text-primary transition-all group"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-text-muted bg-transparent group-hover:border-text-primary group-hover:text-text-primary transition-colors">
                    <Plus className="h-4 w-4" />
                  </div>
                  <span>New Server</span>
                </button>
              </div>
            </div>
          ) : activeTab === "messages" ? (
            <div className="space-y-1">
              <div className="mb-3 px-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-text-muted">
                  DIRECT MESSAGES
                </span>
                <button className="text-text-muted hover:text-text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {dmsLoading ? (
                <div className="px-2 text-xs text-text-muted">Loading...</div>
              ) : dmConversations.length === 0 ? (
                <div className="px-2 text-xs text-text-muted text-center mt-6 p-4 rounded-md border border-dashed border-border">
                  No direct messages yet.
                  <br />
                  <span className="text-text-dim mt-1 block">
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
                      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-brand/10 text-brand"
                          : "text-text-secondary hover:bg-background-floating hover:text-text-primary"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background-floating text-xs font-bold text-text-primary shadow-sm">
                        {dm.otherUser.displayName.charAt(0).toUpperCase()}
                      </div>
                      {/* Name + preview */}
                      <div className="min-w-0 flex-1 text-left flex flex-col justify-center">
                        <div className="truncate font-medium">
                          {dm.otherUser.displayName}
                        </div>
                        {dm.lastMessage && (
                          <div className="truncate text-xs text-text-muted mt-0.5">
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
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide truncate pr-2">
                      {currentServerName}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {hasPermission(Permissions.MANAGE_CHANNELS) && (
                        <button
                          onClick={() => setShowCreateChannel(true)}
                          className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-background-floating transition-colors"
                          title="Create Channel"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(isOwner ||
                        hasPermission(Permissions.MANAGE_SERVER)) && (
                        <button
                          onClick={() => setShowServerSettings(true)}
                          className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-background-floating transition-colors"
                          title="Server Settings"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
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
                              `/servers/${currentServerId}/channels/${channel.id}`,
                            );
                          }}
                          className={`group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                            isOpen
                              ? "bg-brand/10 text-brand font-medium"
                              : "text-text-secondary hover:bg-background-floating hover:text-text-primary font-medium"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <Hash
                              className={`h-4 w-4 shrink-0 ${isOpen ? "text-brand" : "text-text-muted group-hover:text-text-primary"}`}
                            />
                            <span className="truncate">{channel.name}</span>
                          </div>
                          {isStreaming && (
                            <span className="relative flex h-2 w-2 mr-1 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {channels.length === 0 && (
                      <div className="px-2 text-sm text-text-muted mt-2">
                        No channels found
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-text-muted text-center rounded-md border border-dashed border-border mt-4">
                  <ServerIcon className="h-8 w-8 mx-auto mb-3 text-text-dim" />
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
