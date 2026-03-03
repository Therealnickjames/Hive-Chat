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
import type { MentionOption } from "./mention-autocomplete";
import type { MessagePayload } from "@/lib/hooks/use-channel";

interface ChatAreaProps {
  channelId: string;
  channelName: string;
  channelTopic?: string | null;
  /** Callback to expose presenceMap to parent for MemberList */
  onPresenceChange?: (presenceMap: Map<string, { userId: string; username: string; displayName: string; status: string }>) => void;
}

export function ChatArea({
  channelId,
  channelName,
  channelTopic,
  onPresenceChange,
}: ChatAreaProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { refreshMembers, members, bots, hasPermission, markAsRead, unreadMap } = useChatContext();
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
    botTriggerHint,
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
    sendCharterControl,
  } = useChannel(channelId);

  // Delete modal state (TASK-0014)
  const [deleteTarget, setDeleteTarget] = useState<MessagePayload | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);

  const handleDeleteRequest = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message) setDeleteTarget(message);
    },
    [messages]
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

  const mentionOptions: MentionOption[] = useMemo(() => {
    const memberOptions: MentionOption[] = members.map((member) => ({
      id: member.userId,
      name: member.displayName,
      type: "user",
      secondary: member.username,
    }));
    const botOptions: MentionOption[] = bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      type: "bot",
      secondary: "Agent",
    }));
    return [...memberOptions, ...botOptions];
  }, [members, bots]);
  const isErrorHint =
    typeof botTriggerHint === "string" &&
    botTriggerHint.startsWith("Bot response failed:");

  useEffect(() => {
    if (!botTriggerHint) return;
    const node = hintRef.current;
    const rect = node?.getBoundingClientRect();
    const style = node ? window.getComputedStyle(node) : null;

    // #region agent log
    fetch("http://127.0.0.1:7856/ingest/0c40b409-8f04-4dd8-a742-cb291a1de852", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "e9a21d",
      },
      body: JSON.stringify({
        sessionId: "e9a21d",
        runId: "post-fix",
        hypothesisId: "H14",
        location: "chat-area.tsx:hint_rendered",
        message: "Hint rendered in ChatArea",
        data: {
          channelId,
          hintLen: botTriggerHint.length,
          inViewport: rect
            ? rect.bottom > 0 &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              rect.top < window.innerHeight
            : false,
          fontSize: style?.fontSize || null,
          lineHeight: style?.lineHeight || null,
          opacity: style?.opacity || null,
          textColor: style?.color || null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [botTriggerHint, channelId]);

  useEffect(() => {
    if (isConnected) return;
    const status = hasJoinedOnce ? "disconnected" : "connecting";

    // #region agent log
    fetch("http://127.0.0.1:7856/ingest/0c40b409-8f04-4dd8-a742-cb291a1de852", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "e9a21d",
      },
      body: JSON.stringify({
        sessionId: "e9a21d",
        runId: "post-fix",
        hypothesisId: "H23",
        location: "chat-area.tsx:connection_status_visible",
        message: "ChatArea rendered channel connection status",
        data: {
          channelId,
          hasJoinedOnce,
          status,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [channelId, isConnected, hasJoinedOnce]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChannelHeader
        channelName={channelName}
        topic={channelTopic}
        charterState={charterState}
        onCharterPause={() => sendCharterControl("pause")}
        onCharterEnd={() => sendCharterControl("end")}
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
      />
      <TypingIndicator typingUsers={typingUsers} />
      {botTriggerHint && (
        <div
          ref={hintRef}
          role="status"
          aria-live="polite"
          className={
            isErrorHint
              ? "border-t border-status-dnd/50 bg-status-dnd/10 px-4 py-2 text-xs font-semibold tracking-wide text-status-dnd"
              : "border-t border-brand/40 bg-brand/10 px-4 py-2 text-xs font-semibold tracking-wide text-text-secondary"
          }
        >
          {botTriggerHint}
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
    </div>
  );
}
