"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { useChatContext } from "@/components/providers/chat-provider";
import { useChannel } from "@/lib/hooks/use-channel";
import type { MessagePayload } from "@/lib/hooks/use-channel";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import type { MentionOption } from "@/components/chat/mention-autocomplete";
import { ChannelSettingsModal } from "@/components/modals/channel-settings-modal";
import { DeleteMessageModal } from "@/components/modals/delete-message-modal";
import { Permissions } from "@/lib/permissions";
import { PanelState } from "@/lib/hooks/use-panel-state";
import { X, Minus, Maximize2, Minimize2, Settings2, Hash } from "lucide-react";

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

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { servers, serverDataById, ensureServerScopedData, hasPermission } =
    useChatContext();
  const canManageMessages = hasPermission(Permissions.MANAGE_MESSAGES);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MessagePayload | null>(null);
  const {
    messages,
    agentTriggerHint,
    sendMessage,
    editMessage,
    deleteMessage,
    loadHistory,
    updateReactions,
    hasMoreHistory,
    isConnected,
    hasJoinedOnce,
    typingUsers,
    sendTyping,
    activeStreamCount,
  } = useChannel(panel.channelId);

  const handleDeleteRequest = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message) setDeleteTarget(message);
    },
    [messages],
  );

  const handleDeleteConfirm = useCallback(async (): Promise<boolean> => {
    if (!deleteTarget) return false;
    return deleteMessage(deleteTarget.id);
  }, [deleteTarget, deleteMessage]);

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

  const resizeRef = useRef<{
    isResizing: boolean;
    startX: number;
    startY: number;
    panelW: number;
    panelH: number;
  }>({
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
        .userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent;
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
          !candidate.isMinimized,
      )
      .sort((a, b) => b.zIndex - a.zIndex)[0];

    if (fallbackPanel) {
      router.replace(
        `/servers/${fallbackPanel.serverId}/channels/${fallbackPanel.channelId}`,
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
    const panelRect = (
      e.currentTarget.parentElement as HTMLDivElement | null
    )?.getBoundingClientRect();
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
    toggleMaximizePanel(
      panel.id,
      Math.floor(rect.width),
      Math.floor(rect.height),
    );
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
        const maxX = Math.max(
          0,
          workspaceRect.width - panelMetricsRef.current.width,
        );
        const maxY = Math.max(
          0,
          workspaceRect.height - panelMetricsRef.current.height,
        );
        const newX = Math.min(maxX, Math.max(0, rawX));
        const newY = Math.min(maxY, Math.max(0, rawY));
        updatePanelPosition(panel.id, newX, newY);
      }
      if (resizeRef.current.isResizing) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        const maxW = Math.max(
          300,
          workspaceRect.width - panelMetricsRef.current.x,
        );
        const maxH = Math.max(
          200,
          workspaceRect.height - panelMetricsRef.current.y,
        );
        const newW = Math.min(
          maxW,
          Math.max(300, resizeRef.current.panelW + dx),
        );
        const newH = Math.min(
          maxH,
          Math.max(200, resizeRef.current.panelH + dy),
        );
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
    const scopedAgents = serverDataById[panel.serverId]?.agents || [];

    const memberOptions: MentionOption[] = scopedMembers.map((member) => ({
      id: member.userId,
      name: member.displayName,
      type: "user",
      secondary: member.username,
    }));
    const agentOptions: MentionOption[] = scopedAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: "agent",
      secondary: "Agent",
    }));
    return [...memberOptions, ...agentOptions];
  }, [panel.serverId, serverDataById]);
  const panelServerName = useMemo(
    () => servers.find((server) => server.id === panel.serverId)?.name,
    [servers, panel.serverId],
  );

  const channelData = useMemo(() => {
    const scoped = serverDataById[panel.serverId];
    return scoped?.channels?.find((ch) => ch.id === panel.channelId);
  }, [serverDataById, panel.serverId, panel.channelId]);

  const hasActiveStream = messages.some((m) => m.streamingStatus === "ACTIVE");
  const isErrorHint =
    typeof agentTriggerHint === "string" &&
    agentTriggerHint.startsWith("Agent response failed:");

  useEffect(() => {
    setStreamState(panel.channelId, hasActiveStream);
    return () => setStreamState(panel.channelId, false);
  }, [hasActiveStream, panel.channelId, setStreamState]);

  if (panel.isMinimized || panel.isClosed) return null;

  return (
    <div
      onMouseDown={focusAndSyncRoute}
      className="chrome-panel absolute flex flex-col overflow-hidden rounded-[24px] border border-white/10 shadow-[0_26px_70px_rgba(2,8,20,0.42)] ring-1 ring-white/5"
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
        className={`flex h-[44px] shrink-0 items-center justify-between border-b border-white/8 bg-[linear-gradient(180deg,rgba(24,39,70,0.98),rgba(18,30,54,0.92))] px-4 ${
          panel.isMaximized
            ? "cursor-default"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <div className="flex items-center gap-3.5">
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
                aria-label={
                  panel.isMaximized ? "Restore panel" : "Maximize panel"
                }
              />
            </div>
          )}
          <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-white select-none">
            <Hash className="h-3.5 w-3.5" />
            {panel.channelName}
          </span>
          {panelServerName && (
            <span className="rounded-full border border-white/6 bg-background-tertiary/45 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted select-none">
              @{panelServerName}
            </span>
          )}
          {hasPermission(Permissions.MANAGE_CHANNELS) && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowChannelSettings(true)}
              className="ml-1 rounded-lg p-1 text-text-dim transition-colors hover:bg-background-tertiary/55 hover:text-text-primary"
              title="Channel Settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 text-xs select-none">
          {hasActiveStream ? (
            <div className="flex items-center gap-1.5 rounded-full border border-accent-green/20 bg-accent-green/10 px-2.5 py-1 font-semibold tracking-[0.16em] text-accent-green">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-cyan opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-cyan"></span>
              </span>
              LIVE
            </div>
          ) : (
            <span className="rounded-full border border-white/8 bg-background-tertiary/45 px-2.5 py-1 font-semibold tracking-[0.16em] text-text-dim">
              IDLE
            </span>
          )}
          {osVariant === "windows" && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="ml-1 flex items-center overflow-hidden rounded-xl border border-white/10 bg-background-tertiary/48"
            >
              <button
                onClick={handleMinimizePanel}
                className="flex h-7 w-8 items-center justify-center text-text-secondary transition hover:bg-background-primary/70 hover:text-text-primary"
                aria-label="Minimize panel"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                onClick={handleToggleMaximize}
                className="flex h-7 w-8 items-center justify-center text-text-secondary transition hover:bg-background-primary/70 hover:text-text-primary"
                aria-label={
                  panel.isMaximized ? "Restore panel" : "Maximize panel"
                }
              >
                {panel.isMaximized ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={handleClosePanel}
                className="flex h-7 w-8 items-center justify-center text-text-secondary transition hover:bg-status-dnd hover:text-white"
                aria-label="Close panel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(14,23,42,0.82),rgba(11,18,34,0.94))]">
        <MessageList
          messages={messages}
          hasMoreHistory={hasMoreHistory}
          onLoadHistory={loadHistory}
          onReactionsChange={updateReactions}
          currentUserId={currentUserId}
          canManageMessages={canManageMessages}
          onEditMessage={editMessage}
          onDeleteMessage={handleDeleteRequest}
          activeStreamCount={activeStreamCount}
        />
        <TypingIndicator typingUsers={typingUsers} />
        {agentTriggerHint && (
          <div
            role="status"
            aria-live="polite"
            className={
              isErrorHint
                ? "border-t border-status-dnd/35 bg-status-dnd/10 px-4 py-2.5 text-sm font-semibold text-status-dnd"
                : "border-t border-brand/20 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-orange-100"
            }
          >
            {agentTriggerHint}
          </div>
        )}
        {!isConnected && (
          <div
            className={
              hasJoinedOnce
                ? "border-t border-white/8 px-4 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-status-dnd"
                : "border-t border-white/8 px-4 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-brand"
            }
          >
            {hasJoinedOnce
              ? "DISCONNECTED FROM CHANNEL GATEWAY"
              : "CONNECTING TO CHANNEL GATEWAY..."}
          </div>
        )}
        <div className="mt-auto border-t border-white/8 bg-background-secondary/58 pt-2">
          <MessageInput
            onSend={sendMessage}
            onTyping={sendTyping}
            disabled={!isConnected}
            channelName={panel.channelName}
            mentionOptions={mentionOptions}
          />
        </div>
      </div>

      {/* Resize Handle */}
      {!panel.isMaximized && (
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute bottom-1 right-1 z-10 h-3 w-3 cursor-nwse-resize"
        >
          <div className="pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 rounded-br-[2px] border-b border-r border-text-dim/80" />
        </div>
      )}

      <ChannelSettingsModal
        isOpen={showChannelSettings}
        onClose={() => setShowChannelSettings(false)}
        channelId={panel.channelId}
        channelName={panel.channelName}
        currentAgentIds={channelData?.agentIds}
        currentDefaultAgentId={channelData?.defaultAgentId ?? null}
      />
      <DeleteMessageModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        messagePreview={deleteTarget?.content || ""}
        authorName={deleteTarget?.authorName || ""}
      />
    </div>
  );
}
