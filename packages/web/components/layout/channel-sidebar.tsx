"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useChatContext } from "@/components/providers/chat-provider";
import { CreateChannelModal } from "@/components/modals/create-channel-modal";
import { ManageBotsModal } from "@/components/modals/manage-bots-modal";
import { RoleManagementModal } from "@/components/modals/role-management-modal";
import { ChannelSettingsModal } from "@/components/modals/channel-settings-modal";
import { InviteModal } from "@/components/modals/invite-modal";
import { Permissions } from "@/lib/permissions";

export function ChannelSidebar() {
  const { data: session } = useSession();
  const {
    currentServerId,
    currentChannelId,
    currentServerName,
    channels,
    hasPermission,
  } = useChatContext();
  const router = useRouter();
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showManageBots, setShowManageBots] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [channelSettingsTarget, setChannelSettingsTarget] = useState<{
    id: string;
    name: string;
    defaultBotId: string | null;
  } | null>(null);

  const displayName = session?.user?.displayName || "User";
  const username = session?.user?.username || "username";

  return (
    <>
      <div className="flex w-60 flex-col bg-background-secondary">
        {/* Server name header */}
        <div className="flex h-12 items-center justify-between border-b border-background-tertiary px-4">
          <h2 className="truncate text-base font-bold text-text-primary">
            {currentServerName || "HiveChat"}
          </h2>
          {hasPermission(Permissions.CREATE_INVITE) && currentServerId && (
            <button
              onClick={() => setShowInvite(true)}
              title="Create invite"
              className="flex-shrink-0 text-text-muted transition hover:text-text-primary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </button>
          )}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 pt-4">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase text-text-muted">
              Text Channels
            </span>
            {hasPermission(Permissions.MANAGE_CHANNELS) && currentServerId && (
              <button
                onClick={() => setShowCreateChannel(true)}
                title="Create channel"
                className="text-text-muted transition hover:text-text-primary"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                </svg>
              </button>
            )}
          </div>

          {channels.length === 0 && !currentServerId && (
            <p className="px-2 py-2 text-xs text-text-muted">
              Select a server to see channels
            </p>
          )}

          {channels.map((channel) => {
            const isActive = currentChannelId === channel.id;
            const hasBot = !!channel.defaultBotId;
            return (
              <div
                key={channel.id}
                className={`group flex w-full items-center gap-1.5 rounded px-2 py-1.5 transition ${
                  isActive
                    ? "bg-background-primary text-text-primary"
                    : "text-text-secondary hover:bg-background-primary hover:text-text-primary"
                }`}
              >
                <button
                  onClick={() =>
                    router.push(
                      `/servers/${currentServerId}/channels/${channel.id}`
                    )
                  }
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                >
                  <span className="text-lg text-text-muted">#</span>
                  <span className="truncate text-sm">{channel.name}</span>
                  {hasBot && (
                    <span
                      className="flex-shrink-0 text-emerald-400"
                      title="Bot assigned"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                      >
                        <path d="M8 1a2 2 0 012 2v1h2a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h2V3a2 2 0 012-2zm-2 7a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z" />
                      </svg>
                    </span>
                  )}
                </button>
                {hasPermission(Permissions.MANAGE_CHANNELS) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setChannelSettingsTarget({
                        id: channel.id,
                        name: channel.name,
                        defaultBotId: channel.defaultBotId,
                      });
                    }}
                    title="Channel settings"
                    className="hidden flex-shrink-0 text-text-muted transition hover:text-text-primary group-hover:block"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}

          {hasPermission(Permissions.MANAGE_BOTS) && currentServerId && (
            <div className="mt-4 px-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-text-muted">
                  AI Bots
                </span>
              </div>
              <button
                onClick={() => setShowManageBots(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
              >
                <span className="text-emerald-400">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 1a2 2 0 012 2v1h2a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h2V3a2 2 0 012-2zm-2 7a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z" />
                  </svg>
                </span>
                <span className="text-sm">Manage Bots</span>
              </button>
            </div>
          )}

          {hasPermission(Permissions.MANAGE_ROLES) && currentServerId && (
            <div className="mt-2 px-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-text-muted">
                  Roles
                </span>
              </div>
              <button
                onClick={() => setShowRoles(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
              >
                <span className="text-blue-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                  </svg>
                </span>
                <span className="text-sm">Manage Roles</span>
              </button>
            </div>
          )}
        </div>

        {/* User panel */}
        <div className="flex items-center gap-2 border-t border-background-tertiary bg-background-floating/50 px-2 py-2">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-background-floating">
              {displayName?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background-floating bg-status-online" />
          </div>

          {/* User info */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">
              {displayName}
            </p>
            <p className="truncate text-xs text-text-muted">{username}</p>
          </div>

          {/* Sign out */}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-text-muted transition hover:bg-background-primary hover:text-text-primary"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM6.5 5.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8 13a5 5 0 01-3.87-1.84C4.56 10.1 6.19 9.5 8 9.5s3.44.6 3.87 1.66A5 5 0 018 13z" />
            </svg>
          </button>
        </div>
      </div>

      <CreateChannelModal
        isOpen={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
      />

      <ManageBotsModal
        isOpen={showManageBots}
        onClose={() => setShowManageBots(false)}
      />

      <InviteModal isOpen={showInvite} onClose={() => setShowInvite(false)} />

      <RoleManagementModal
        isOpen={showRoles}
        onClose={() => setShowRoles(false)}
      />

      {channelSettingsTarget && (
        <ChannelSettingsModal
          isOpen={true}
          onClose={() => setChannelSettingsTarget(null)}
          channelId={channelSettingsTarget.id}
          channelName={channelSettingsTarget.name}
          currentDefaultBotId={channelSettingsTarget.defaultBotId}
        />
      )}
    </>
  );
}
