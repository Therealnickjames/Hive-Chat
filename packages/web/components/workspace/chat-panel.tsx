"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { useChatContext } from "@/components/providers/chat-provider";
import { useChannel } from "@/lib/hooks/use-channel";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import type { MentionOption } from "@/components/chat/mention-autocomplete";
import { ChannelSettingsModal } from "@/components/modals/channel-settings-modal";
import { Permissions } from "@/lib/permissions";
import { PanelState } from "@/lib/hooks/use-panel-state";

interface ChatPanelProps {
  panel: PanelState;
}

export function ChatPanel({ panel }: ChatPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    panels,
    focusPanel,
    closePanel,
    minimizePanel,
    toggleMaximizePanel,
    updatePanelPosition,
    updatePanelSize,
    setStreamState,
  } = useWorkspaceContext();

  const { servers, serverDataById, ensureServerScopedData, hasPermission } = useChatContext();
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const {
    messages,
    sendMessage,
    loadHistory,
    updateReactions,
    hasMoreHistory,
    isConnected,
    typingUsers,
    sendTyping,
    activeStreamCount,
  } = useChannel(panel.channelId);

  useEffect(() => {
    void ensureServerScopedData(panel.serverId);
  }, [panel.serverId, ensureServerScopedData]);

  const dragRef = useRef<{
    isDragging: boolean;
    offsetX: number;
    offsetY: number;
  }>({
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
  });

  const resizeRef = useRef<{ isResizing: boolean; startX: number; startY: number; panelW: number; panelH: number }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    panelW: panel.width,
    panelH: panel.height,
  });

  const panelMetricsRef = useRef({
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
  });

  useEffect(() => {
    panelMetricsRef.current = {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    };
  }, [panel.x, panel.y, panel.width, panel.height]);

  useEffect(() => {
    if (!resizeRef.current.isResizing) {
      resizeRef.current.panelW = panel.width;
      resizeRef.current.panelH = panel.height;
    }
  }, [panel.width, panel.height]);

  const osVariant = useMemo<"mac" | "windows">(() => {
    if (typeof navigator === "undefined") return "windows";
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform || navigator.platform || navigator.userAgent;
    return /mac/i.test(platform) ? "mac" : "windows";
  }, []);

  const focusAndSyncRoute = () => {
    focusPanel(panel.id);
    const target = `/servers/${panel.serverId}/channels/${panel.channelId}`;
    if (pathname !== target) {
      router.replace(target);
    }
  };

  const syncRouteAfterHide = () => {
    const panelRoute = `/servers/${panel.serverId}/channels/${panel.channelId}`;
    if (pathname !== panelRoute) return;

    const fallbackPanel = [...panels]
      .filter(
        (candidate) =>
          candidate.id !== panel.id &&
          !candidate.isClosed &&
          !candidate.isMinimized
      )
      .sort((a, b) => b.zIndex - a.zIndex)[0];

    if (fallbackPanel) {
      router.replace(
        `/servers/${fallbackPanel.serverId}/channels/${fallbackPanel.channelId}`
      );
      return;
    }

    router.replace(`/servers/${panel.serverId}`);
  };

  const handleClosePanel = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    closePanel(panel.id);
    syncRouteAfterHide();
  };

  const handleMinimizePanel = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    minimizePanel(panel.id);
    syncRouteAfterHide();
  };

  const handleMouseDownDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (panel.isMaximized) return;
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
    e.preventDefault();
    const workspace = document.getElementById("workspace-root");
    const panelRect = (e.currentTarget.parentElement as HTMLDivElement | null)?.getBoundingClientRect();
    if (!workspace || !panelRect) return;
    dragRef.current.isDragging = true;
    dragRef.current.offsetX = e.clientX - panelRect.left;
    dragRef.current.offsetY = e.clientY - panelRect.top;
    focusAndSyncRoute();
    document.body.style.userSelect = "none";
  };

  const handleMouseDownResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (panel.isMaximized) return;
    e.preventDefault();
    resizeRef.current.isResizing = true;
    resizeRef.current.startX = e.clientX;
    resizeRef.current.startY = e.clientY;
    resizeRef.current.panelW = panel.width;
    resizeRef.current.panelH = panel.height;
    focusAndSyncRoute();
    document.body.style.userSelect = "none";
  };

  const handleToggleMaximize = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const workspace = document.getElementById("workspace-root");
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    toggleMaximizePanel(panel.id, Math.floor(rect.width), Math.floor(rect.height));
    focusAndSyncRoute();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const workspace = document.getElementById("workspace-root");
      if (!workspace) return;
      const workspaceRect = workspace.getBoundingClientRect();

      if (dragRef.current.isDragging) {
        const rawX = e.clientX - workspaceRect.left - dragRef.current.offsetX;
        const rawY = e.clientY - workspaceRect.top - dragRef.current.offsetY;
        const maxX = Math.max(0, workspaceRect.width - panelMetricsRef.current.width);
        const maxY = Math.max(0, workspaceRect.height - panelMetricsRef.current.height);
        const newX = Math.min(maxX, Math.max(0, rawX));
        const newY = Math.min(maxY, Math.max(0, rawY));
        updatePanelPosition(panel.id, newX, newY);
      }
      if (resizeRef.current.isResizing) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        const maxW = Math.max(300, workspaceRect.width - panelMetricsRef.current.x);
        const maxH = Math.max(200, workspaceRect.height - panelMetricsRef.current.y);
        const newW = Math.min(maxW, Math.max(300, resizeRef.current.panelW + dx));
        const newH = Math.min(maxH, Math.max(200, resizeRef.current.panelH + dy));
        updatePanelSize(panel.id, newW, newH);
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current.isDragging || resizeRef.current.isResizing) {
        dragRef.current.isDragging = false;
        resizeRef.current.isResizing = false;
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [panel.id, updatePanelPosition, updatePanelSize]);

  const mentionOptions: MentionOption[] = useMemo(() => {
    const scopedMembers = serverDataById[panel.serverId]?.members || [];
    const scopedBots = serverDataById[panel.serverId]?.bots || [];

    const memberOptions: MentionOption[] = scopedMembers.map((member) => ({
      id: member.userId,
      name: member.displayName,
      type: "user",
      secondary: member.username,
    }));
    const botOptions: MentionOption[] = scopedBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      type: "bot",
      secondary: "Agent",
    }));
    return [...memberOptions, ...botOptions];
  }, [panel.serverId, serverDataById]);
  const panelServerName = useMemo(
    () => servers.find((server) => server.id === panel.serverId)?.name,
    [servers, panel.serverId]
  );

  const channelData = useMemo(() => {
    const scoped = serverDataById[panel.serverId];
    return scoped?.channels?.find((ch) => ch.id === panel.channelId);
  }, [serverDataById, panel.serverId, panel.channelId]);

  const hasActiveStream = messages.some((m) => m.streamingStatus === "ACTIVE");

  useEffect(() => {
    setStreamState(panel.channelId, hasActiveStream);
    return () => setStreamState(panel.channelId, false);
  }, [hasActiveStream, panel.channelId, setStreamState]);

  if (panel.isMinimized || panel.isClosed) return null;

  return (
    <div
      onMouseDown={focusAndSyncRoute}
      className="absolute flex flex-col rounded-lg border border-border bg-background-primary shadow-2xl overflow-hidden"
      style={{
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.height,
        zIndex: panel.zIndex,
      }}
    >
      {/* Titlebar */}
      <div
        onMouseDown={handleMouseDownDrag}
        className={`flex h-[38px] shrink-0 items-center justify-between border-b border-border bg-background-secondary px-3 ${
          panel.isMaximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <div className="flex items-center gap-3">
          {osVariant === "mac" && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5"
            >
              <button
                onClick={handleClosePanel}
                className="h-3 w-3 rounded-full bg-status-dnd opacity-70 transition-opacity hover:opacity-100"
                aria-label="Close panel"
              />
              <button
                onClick={handleMinimizePanel}
                className="h-3 w-3 rounded-full bg-brand opacity-70 transition-opacity hover:opacity-100"
                aria-label="Minimize panel"
              />
              <button
                onClick={handleToggleMaximize}
                className="h-3 w-3 rounded-full bg-status-online opacity-70 transition-opacity hover:opacity-100"
                aria-label={panel.isMaximized ? "Restore panel" : "Maximize panel"}
              />
            </div>
          )}
          <span className="font-mono text-xs font-bold text-text-secondary select-none">
            # {panel.channelName}
          </span>
          {panelServerName && (
            <span className="font-mono text-[10px] text-text-dim uppercase tracking-wider select-none">
              @{panelServerName}
            </span>
          )}
          {hasPermission(Permissions.MANAGE_CHANNELS) && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowChannelSettings(true)}
              className="ml-1 text-text-dim hover:text-text-primary transition-colors"
              title="Channel Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs select-none">
          {hasActiveStream ? (
            <div className="flex items-center gap-1.5 text-accent-cyan font-bold tracking-wider">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-cyan opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-cyan"></span>
              </span>
              LIVE
            </div>
          ) : (
            <span className="text-text-dim font-bold tracking-wider">IDLE</span>
          )}
          {osVariant === "windows" && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="ml-2 flex items-center overflow-hidden rounded border border-border"
            >
              <button
                onClick={handleMinimizePanel}
                className="h-5 w-6 text-[10px] text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
                aria-label="Minimize panel"
              >
                _
              </button>
              <button
                onClick={handleToggleMaximize}
                className="h-5 w-6 text-[10px] text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
                aria-label={panel.isMaximized ? "Restore panel" : "Maximize panel"}
              >
                {panel.isMaximized ? "❐" : "□"}
              </button>
              <button
                onClick={handleClosePanel}
                className="h-5 w-6 text-[10px] text-text-secondary transition hover:bg-status-dnd hover:text-white"
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background-primary">
        <MessageList
          messages={messages}
          hasMoreHistory={hasMoreHistory}
          onLoadHistory={loadHistory}
          onReactionsChange={updateReactions}
          activeStreamCount={activeStreamCount}
        />
        <TypingIndicator typingUsers={typingUsers} />
        {!isConnected && (
          <div className="border-t border-border px-4 py-1 text-[10px] font-bold tracking-wider text-status-dnd">
            DISCONNECTED FROM CHANNEL GATEWAY
          </div>
        )}
        <div className="border-t border-border mt-auto pt-2 bg-background-secondary">
          <MessageInput
            onSend={sendMessage}
            onTyping={sendTyping}
            disabled={false}
            channelName={panel.channelName}
            mentionOptions={mentionOptions}
          />
        </div>
      </div>

      {/* Resize Handle */}
      {!panel.isMaximized && (
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 cursor-nwse-resize z-10"
        >
          <div className="absolute bottom-0 right-0 h-2 w-2 border-b border-r border-text-dim pointer-events-none rounded-br-[1px]" />
        </div>
      )}

      <ChannelSettingsModal
        isOpen={showChannelSettings}
        onClose={() => setShowChannelSettings(false)}
        channelId={panel.channelId}
        channelName={panel.channelName}
        currentBotIds={channelData?.botIds}
        currentDefaultBotId={channelData?.defaultBotId ?? null}
      />
    </div>
  );
}
