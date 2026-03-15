// TODO(PROD-READY): Legacy component — replaced by ChatPanel (workspace/chat-panel.tsx).
// Not imported or mounted anywhere. Retained for reference until ChatPanel is stable.
// Remove entirely once ChatPanel covers all edge cases. See production-readiness audit.
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useChatContext } from "@/components/providers/chat-provider";
import { useChannel } from "@/lib/hooks/use-channel";
import { Permissions } from "@/lib/permissions";
import { ChannelHeader } from "./channel-header";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { TypingIndicator } from "./typing-indicator";
import { DeleteMessageModal } from "@/components/modals/delete-message-modal";
import { SearchPanel } from "@/components/search/search-panel";
import type { MentionOption } from "./mention-autocomplete";
import type { MessagePayload } from "@/lib/hooks/use-channel";

interface ChatAreaProps {
  channelId: string;
  channelName: string;
  channelTopic?: string | null;
  /** Callback to expose presenceMap to parent for MemberList */
  onPresenceChange?: (
    presenceMap: Map<
      string,
      { userId: string; username: string; displayName: string; status: string }
    >,
  ) => void;
}

export function ChatArea({
  channelId,
  channelName,
  channelTopic,
  onPresenceChange,
}: ChatAreaProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const {
    refreshMembers,
    members,
    agents,
    channels,
    hasPermission,
    markAsRead,
    unreadMap,
    currentServerId,
  } = useChatContext();
  const canManageMessages = hasPermission(Permissions.MANAGE_MESSAGES);

  // TASK-0016: Capture lastReadSeq BEFORE we mark-as-read, so the divider shows correctly.
  // Reset whenever channelId changes.
  const lastReadSeqRef = useRef<string | null>(null);
  const capturedChannelRef = useRef<string | null>(null);
  if (channelId !== capturedChannelRef.current) {
    // Channel changed — capture the current lastReadSeq for the new channel
    const unread = unreadMap.get(channelId);
    lastReadSeqRef.current = unread?.lastReadSeq ?? null;
    capturedChannelRef.current = channelId;
  }

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
    presenceMap,
    activeStreamCount,
    charterState,
    setCharterState,
    sendCharterControl,
  } = useChannel(channelId);

  // TASK-0022: Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(
    null,
  );

  // Delete modal state (TASK-0014)
  const [deleteTarget, setDeleteTarget] = useState<MessagePayload | null>(null);

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

  // TASK-0016: Mark channel as read when the user views it
  useEffect(() => {
    if (channelId) {
      markAsRead(channelId);
    }
  }, [channelId, markAsRead]);

  // Expose presence to parent when it changes.
  useEffect(() => {
    if (onPresenceChange) {
      onPresenceChange(presenceMap);
    }
  }, [presenceMap, onPresenceChange]);

  // Refresh member list when presence grows (e.g. someone joins via invite).
  const prevPresenceSize = useRef(0);
  useEffect(() => {
    if (presenceMap.size > prevPresenceSize.current) {
      void refreshMembers();
    }
    prevPresenceSize.current = presenceMap.size;
  }, [presenceMap.size, refreshMembers]);

  // TASK-0020: Fetch initial charter state on channel load
  useEffect(() => {
    if (!currentServerId || !channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/servers/${currentServerId}/channels/${channelId}`,
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
        // Non-critical — charter state will update via WebSocket events
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentServerId, channelId, setCharterState]);

  // TASK-0020: Charter start/resume via REST (needs session auth + MANAGE_CHANNELS)
  const canManageChannels = hasPermission(Permissions.MANAGE_CHANNELS);
  const handleCharterAction = useCallback(
    async (action: "start" | "resume") => {
      if (!currentServerId || !channelId) return;
      try {
        const res = await fetch(
          `/api/servers/${currentServerId}/channels/${channelId}/charter`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        if (!res.ok) {
          console.error(`Charter ${action} failed:`, await res.text());
          return;
        }
        // Optimistically update local charterState from REST response
        const data = await res.json();
        setCharterState((prev) => ({
          swarmMode: data.swarmMode || prev?.swarmMode || "HUMAN_IN_THE_LOOP",
          currentTurn: data.charterCurrentTurn ?? 0,
          maxTurns: data.charterMaxTurns ?? 0,
          status: data.charterStatus || "ACTIVE",
        }));
      } catch (err) {
        console.error(`Charter ${action} error:`, err);
      }
    },
    [currentServerId, channelId, setCharterState],
  );

  const mentionOptions: MentionOption[] = useMemo(() => {
    const memberOptions: MentionOption[] = members.map((member) => ({
      id: member.userId,
      name: member.displayName,
      type: "user",
      secondary: member.username,
    }));
    const agentOptions: MentionOption[] = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: "agent",
      secondary: "Agent",
    }));
    return [...memberOptions, ...agentOptions];
  }, [members, agents]);
  const isErrorHint =
    typeof agentTriggerHint === "string" &&
    agentTriggerHint.startsWith("Agent response failed:");

  // TASK-0022: Search panel data
  const searchChannels = useMemo(
    () => channels.map((ch) => ({ id: ch.id, name: ch.name })),
    [channels],
  );
  const searchMembers = useMemo(
    () => members.map((m) => ({ id: m.userId, name: m.displayName })),
    [members],
  );

  const handleJumpToMessage = useCallback(
    (_channelId: string, messageId: string) => {
      // For v1: only jump within current channel's loaded messages
      setScrollToMessageId(messageId);
      setIsSearchOpen(false);
    },
    [],
  );

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <ChannelHeader
        channelName={channelName}
        topic={channelTopic}
        charterState={charterState}
        onCharterStart={
          canManageChannels ? () => handleCharterAction("start") : undefined
        }
        onCharterPause={
          canManageChannels ? () => sendCharterControl("pause") : undefined
        }
        onCharterResume={
          canManageChannels ? () => handleCharterAction("resume") : undefined
        }
        onCharterEnd={
          canManageChannels ? () => sendCharterControl("end") : undefined
        }
        onSearchToggle={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
      />
      <MessageList
        messages={messages}
        hasMoreHistory={hasMoreHistory}
        onLoadHistory={loadHistory}
        onReactionsChange={updateReactions}
        currentUserId={currentUserId}
        canManageMessages={canManageMessages}
        onEditMessage={editMessage}
        onDeleteMessage={handleDeleteRequest}
        lastReadSeq={lastReadSeqRef.current}
        activeStreamCount={activeStreamCount}
        hasAgents={agents.length > 0}
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
              ? "border-t border-status-dnd/50 bg-status-dnd/10 px-4 py-2 text-sm font-bold tracking-wide text-status-dnd"
              : "border-t border-brand/60 bg-brand/20 px-4 py-2 text-sm font-bold tracking-wide text-brand"
          }
        >
          {agentTriggerHint}
        </div>
      )}
      {!isConnected && (
        <div
          className={
            hasJoinedOnce
              ? "border-t border-border px-4 py-1 text-[10px] font-bold tracking-wider text-status-dnd"
              : "border-t border-border px-4 py-1 text-[10px] font-bold tracking-wider text-brand"
          }
        >
          {hasJoinedOnce
            ? "DISCONNECTED FROM CHANNEL GATEWAY"
            : "CONNECTING TO CHANNEL GATEWAY..."}
        </div>
      )}
      <MessageInput
        onSend={sendMessage}
        onTyping={sendTyping}
        disabled={!isConnected}
        channelName={channelName}
        mentionOptions={mentionOptions}
      />

      {/* Delete confirmation modal (TASK-0014) */}
      <DeleteMessageModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        messagePreview={deleteTarget?.content || ""}
        authorName={deleteTarget?.authorName || ""}
      />

      {/* TASK-0022: Search panel (slide-in from right) */}
      {isSearchOpen && currentServerId && (
        <SearchPanel
          serverId={currentServerId}
          mode="server"
          channels={searchChannels}
          members={searchMembers}
          onClose={() => setIsSearchOpen(false)}
          onJumpToMessage={handleJumpToMessage}
        />
      )}
    </div>
  );
}
