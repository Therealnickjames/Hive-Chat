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
import { ChannelHeader } from "@/components/chat/channel-header";
import { ChannelSettingsModal } from "@/components/modals/channel-settings-modal";
import { DeleteMessageModal } from "@/components/modals/delete-message-modal";
import { Permissions } from "@/lib/permissions";
import { PanelState } from "@/lib/hooks/use-panel-state";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Settings2,
  Hash,
  Search,
} from "lucide-react";
import { SearchPanel } from "@/components/search/search-panel";

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
  // TASK-0022: Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(
    null,
  );
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
    charterState,
    setCharterState,
    sendCharterControl,
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

  // TASK-0021: Resume stream from checkpoint
  const handleResumeStream = useCallback(
    async (messageId: string, checkpointIndex: number, agentId: string) => {
      try {
        const res = await fetch("/api/stream/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, checkpointIndex, agentId }),
        });
        if (!res.ok) {
          const data = await res.json();
          console.error("[stream/resume] Failed:", data.error);
        }
      } catch (err) {
        console.error("[stream/resume] Error:", err);
      }
    },
    [],
  );

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

  // TASK-0022: Search panel data
  const searchChannels = useMemo(() => {
    const scoped = serverDataById[panel.serverId];
    return (scoped?.channels || []).map((ch) => ({ id: ch.id, name: ch.name }));
  }, [serverDataById, panel.serverId]);

  const searchMembers = useMemo(() => {
    const scoped = serverDataById[panel.serverId];
    return (scoped?.members || []).map((m) => ({
      id: m.userId,
      name: m.displayName,
    }));
  }, [serverDataById, panel.serverId]);

  const handleJumpToMessage = useCallback(
    (channelId: string, messageId: string) => {
      setScrollToMessageId(messageId);
      setIsSearchOpen(false);
    },
    [],
  );

  // TASK-0020: Fetch initial charter state on channel load
  useEffect(() => {
    if (!panel.serverId || !panel.channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/servers/${panel.serverId}/channels/${panel.channelId}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.swarmMode) {
          setCharterState({
            swarmMode: data.swarmMode,
            currentTurn: data.charterCurrentTurn ?? 0,
            maxTurns: data.charterMaxTurns ?? 0,
            status: data.charterStatus || "INACTIVE",
          });
        }
      } catch {
        // Non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel.serverId, panel.channelId, setCharterState]);

  // TASK-0020: Charter start/resume via REST (needs MANAGE_CHANNELS permission)
  const canManageChannels = hasPermission(Permissions.MANAGE_CHANNELS);
  const handleCharterAction = useCallback(
    async (action: "start" | "resume") => {
      if (!panel.serverId || !panel.channelId) return;
      try {
        const res = await fetch(
          `/api/servers/${panel.serverId}/channels/${panel.channelId}/charter`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        setCharterState((prev) => ({
          swarmMode: data.swarmMode || prev?.swarmMode || "HUMAN_IN_THE_LOOP",
          currentTurn: data.charterCurrentTurn ?? 0,
          maxTurns: data.charterMaxTurns ?? 0,
          status: data.charterStatus || "ACTIVE",
        }));
      } catch {
        // Silently fail — charter controls are non-critical
      }
    },
    [panel.serverId, panel.channelId, setCharterState],
  );

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
      className="scanline absolute flex flex-col overflow-hidden rounded-lg border border-white/[0.04] bg-background-floating panel-shadow"
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
        className={`flex h-[40px] shrink-0 items-center justify-between border-b border-white/[0.04] bg-background-elevated px-3 ${
          panel.isMaximized
            ? "cursor-default"
            : "cursor-grab active:cursor-grabbing"
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
                className="h-3 w-3 rounded-full bg-status-dnd opacity-60 transition-opacity hover:opacity-100"
                aria-label="Close panel"
              />
              <button
                onClick={handleMinimizePanel}
                className="h-3 w-3 rounded-full bg-brand opacity-60 transition-opacity hover:opacity-100"
                aria-label="Minimize panel"
              />
              <button
                onClick={handleToggleMaximize}
                className="h-3 w-3 rounded-full bg-status-online opacity-60 transition-opacity hover:opacity-100"
                aria-label={
                  panel.isMaximized ? "Restore panel" : "Maximize panel"
                }
              />
            </div>
          )}
          <span className="flex items-center gap-1.5 font-display text-[13px] font-semibold text-text-primary select-none">
            <Hash className="h-3.5 w-3.5 text-text-dim" />
            {panel.channelName}
          </span>
          {panelServerName && (
            <span className="text-[11px] text-text-muted select-none">
              · {panelServerName}
            </span>
          )}
          {hasPermission(Permissions.MANAGE_CHANNELS) && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowChannelSettings(true)}
              className="rounded p-1 text-text-dim transition-colors hover:text-text-muted"
              title="Channel Settings"
            >
              <Settings2 className="h-3 w-3" />
            </button>
          )}
          {/* TASK-0022: Search toggle */}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setIsSearchOpen((prev) => !prev)}
            className={`rounded p-1 transition-colors ${
              isSearchOpen
                ? "text-text-primary"
                : "text-text-dim hover:text-text-muted"
            }`}
            data-testid="search-toggle-btn"
            aria-label="Search messages"
            title="Search messages"
          >
            <Search className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px] select-none">
          {hasActiveStream ? (
            <div className="flex items-center gap-1.5 font-semibold tracking-[0.12em] text-accent-cyan">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-cyan opacity-60"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-cyan shadow-[0_0_6px_rgba(34,211,238,0.5)]"></span>
              </span>
              LIVE
            </div>
          ) : (
            <span className="font-semibold tracking-[0.12em] text-text-dim">
              IDLE
            </span>
          )}
          {osVariant === "windows" && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="ml-1 flex items-center"
            >
              <button
                onClick={handleMinimizePanel}
                className="flex h-6 w-7 items-center justify-center text-text-dim transition hover:text-text-muted"
                aria-label="Minimize panel"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={handleToggleMaximize}
                className="flex h-6 w-7 items-center justify-center text-text-dim transition hover:text-text-muted"
                aria-label={
                  panel.isMaximized ? "Restore panel" : "Maximize panel"
                }
              >
                {panel.isMaximized ? (
                  <Minimize2 className="h-2.5 w-2.5" />
                ) : (
                  <Maximize2 className="h-2.5 w-2.5" />
                )}
              </button>
              <button
                onClick={handleClosePanel}
                className="flex h-6 w-7 items-center justify-center text-text-dim transition hover:text-status-dnd"
                aria-label="Close panel"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-background-floating">
        {/* TASK-0020: Charter header — only shown when charter has non-default state */}
        {charterState && charterState.swarmMode !== "HUMAN_IN_THE_LOOP" && (
          <ChannelHeader
            channelName={panel.channelName}
            charterState={charterState}
            onCharterStart={
              canManageChannels ? () => handleCharterAction("start") : undefined
            }
            onCharterPause={
              canManageChannels ? () => sendCharterControl("pause") : undefined
            }
            onCharterResume={
              canManageChannels
                ? () => handleCharterAction("resume")
                : undefined
            }
            onCharterEnd={
              canManageChannels ? () => sendCharterControl("end") : undefined
            }
          />
        )}
        <MessageList
          messages={messages}
          hasMoreHistory={hasMoreHistory}
          onLoadHistory={loadHistory}
          onReactionsChange={updateReactions}
          currentUserId={currentUserId}
          canManageMessages={canManageMessages}
          onEditMessage={editMessage}
          onDeleteMessage={handleDeleteRequest}
          onResumeStream={handleResumeStream}
          activeStreamCount={activeStreamCount}
          hasAgents={
            !!(
              channelData?.defaultAgentId ||
              (channelData?.agentIds && channelData.agentIds.length > 0)
            )
          }
          scrollToMessageId={scrollToMessageId}
          onScrollToMessageComplete={() => setScrollToMessageId(null)}
        />
        <TypingIndicator typingUsers={typingUsers} />
        {agentTriggerHint && (
          <div
            role="status"
            aria-live="polite"
            className={
              isErrorHint
                ? "border-t border-status-dnd/35 bg-status-dnd/10 px-4 py-2.5 text-sm font-semibold text-status-dnd"
                : "border-t border-brand/20 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-white"
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
        <div className="mt-auto border-t border-white/[0.03] pt-2">
          <MessageInput
            onSend={sendMessage}
            onTyping={sendTyping}
            disabled={!isConnected}
            channelName={panel.channelName}
            mentionOptions={mentionOptions}
          />
        </div>

        {/* TASK-0022: Search panel */}
        {isSearchOpen && (
          <SearchPanel
            serverId={panel.serverId}
            mode="server"
            channels={searchChannels}
            members={searchMembers}
            onClose={() => setIsSearchOpen(false)}
            onJumpToMessage={handleJumpToMessage}
          />
        )}
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
