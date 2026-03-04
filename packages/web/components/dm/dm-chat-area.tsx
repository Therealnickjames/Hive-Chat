"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { useDmChannel } from "@/lib/hooks/use-dm-channel";
import type { DmMessagePayload } from "@/lib/hooks/use-dm-channel";
import { MessageInput } from "@/components/chat/message-input";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { EditMessageInput } from "@/components/chat/edit-message-input";
import { DeleteMessageModal } from "@/components/modals/delete-message-modal";
import { ReactionBar } from "@/components/chat/reaction-bar";
import type { ReactionData } from "@/lib/hooks/use-channel";
import { formatTime } from "@/lib/format-time";

interface DmChatAreaProps {
  dmId: string;
  otherUserName: string;
}

/**
 * TASK-0019: Chat area for direct messages.
 * Simplified from ChatArea — no streaming, no bots, no unread tracking.
 */
export function DmChatArea({ dmId, otherUserName }: DmChatAreaProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const {
    messages,
    sendMessage,
    editMessage,
    deleteMessage,
    loadHistory,
    hasMoreHistory,
    isConnected,
    typingUsers,
    sendTyping,
  } = useDmChannel(dmId);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<DmMessagePayload | null>(
    null
  );

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* DM Header */}
      <DmHeader otherUserName={otherUserName} />

      {/* Message List */}
      <DmMessageList
        messages={messages}
        hasMoreHistory={hasMoreHistory}
        onLoadHistory={loadHistory}
        currentUserId={currentUserId}
        onEditMessage={editMessage}
        onDeleteMessage={handleDeleteRequest}
        dmId={dmId}
      />

      {/* Typing indicator */}
      <DmTypingIndicator typingUsers={typingUsers} />

      {/* Message input */}
      <MessageInput
        onSend={sendMessage}
        onTyping={sendTyping}
        disabled={!isConnected}
        channelName={otherUserName}
      />

      {/* Delete confirmation modal */}
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

// ---- DM Header ----

function DmHeader({ otherUserName }: { otherUserName: string }) {
  return (
    <div className="flex h-12 items-center border-b border-background-tertiary px-4">
      <div className="flex items-center gap-2">
        <span className="text-xl text-text-muted">@</span>
        <h1 className="text-base font-bold text-text-primary">
          {otherUserName}
        </h1>
      </div>
    </div>
  );
}

// ---- DM Typing Indicator ----

function DmTypingIndicator({
  typingUsers,
}: {
  typingUsers: Array<{ userId: string; displayName: string }>;
}) {
  if (typingUsers.length === 0) {
    return <div className="h-6 px-4" />;
  }

  const text =
    typingUsers.length === 1
      ? `${typingUsers[0].displayName} is typing`
      : "Someone is typing";

  return (
    <div className="flex h-6 items-center gap-1.5 px-4">
      <span className="flex gap-0.5">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:0ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:150ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:300ms]" />
      </span>
      <span className="text-xs text-text-muted">{text}...</span>
    </div>
  );
}

// ---- DM Message List ----

function DmMessageList({
  messages,
  hasMoreHistory,
  onLoadHistory,
  currentUserId,
  onEditMessage,
  onDeleteMessage,
  dmId,
}: {
  messages: DmMessagePayload[];
  hasMoreHistory: boolean;
  onLoadHistory: () => void;
  currentUserId?: string;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => void;
  dmId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 50;

    if (el.scrollTop < 100 && hasMoreHistory) {
      onLoadHistory();
    }
  }, [hasMoreHistory, onLoadHistory]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (isNewMessage && isAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  // Initial scroll to bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el || messages.length === 0) return;

    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      {hasMoreHistory && (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadHistory}
            className="text-xs text-text-dim hover:text-text-secondary transition"
          >
            Load older messages
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-text-muted text-sm">No messages yet</p>
            <p className="text-text-dim text-xs mt-1">
              Send a message to start the conversation
            </p>
          </div>
        </div>
      )}

      {messages.map((message, index) => {
        if (message.isDeleted) {
          return (
            <div key={message.id} className="py-1 px-2">
              <span className="text-xs text-text-dim italic">
                This message has been deleted
              </span>
            </div>
          );
        }

        const prevMessage = index > 0 ? messages[index - 1] : null;
        const isGrouped =
          !!prevMessage &&
          !prevMessage.isDeleted &&
          prevMessage.authorId === message.authorId &&
          new Date(message.createdAt).getTime() -
            new Date(prevMessage.createdAt).getTime() <
            300000; // 5 minutes

        return (
          <DmMessageItem
            key={message.id}
            message={message}
            isGrouped={isGrouped}
            isOwnMessage={message.authorId === currentUserId}
            onEdit={onEditMessage}
            onDelete={onDeleteMessage}
            dmId={dmId}
          />
        );
      })}
    </div>
  );
}

// ---- DM Message Item ----

function DmMessageItem({
  message,
  isGrouped,
  isOwnMessage,
  onEdit,
  onDelete,
  dmId,
}: {
  message: DmMessagePayload;
  isGrouped: boolean;
  isOwnMessage: boolean;
  onEdit?: (messageId: string, content: string) => Promise<boolean>;
  onDelete?: (messageId: string) => void;
  dmId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [reactions, setReactions] = useState<ReactionData[]>(message.reactions || []);

  // Sync reactions from real-time updates
  useEffect(() => {
    setReactions(message.reactions || []);
  }, [message.reactions]);

  const handleEditSave = useCallback(
    async (content: string) => {
      if (!onEdit) return;
      const success = await onEdit(message.id, content);
      if (success) setIsEditing(false);
    },
    [message.id, onEdit]
  );

  if (isGrouped) {
    return (
      <div
        className="group relative py-0.5 pl-14 pr-4 hover:bg-background-secondary/50 transition-colors"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Timestamp on hover */}
        {isHovering && (
          <span className="absolute left-1 top-1 text-[10px] text-text-dim">
            {formatTime(message.createdAt)}
          </span>
        )}

        {isEditing ? (
          <EditMessageInput
            initialContent={message.content}
            onSave={handleEditSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="text-sm text-text-primary leading-relaxed">
            <MarkdownContent content={message.content} mentionNames={[]} />
          </div>
        )}

        {message.editedAt && !isEditing && (
          <span className="text-[10px] text-text-dim ml-1">(edited)</span>
        )}

        {/* Reactions (TASK-0030) */}
        <ReactionBar
          messageId={message.id}
          reactions={reactions}
          onReactionsChange={setReactions}
          apiBasePath={`/api/dms/${dmId}/messages`}
        />

        {/* Actions */}
        {isHovering && !isEditing && isOwnMessage && (
          <div className="absolute -top-2 right-2 flex gap-1 rounded border border-border bg-background-primary p-0.5 shadow-sm">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded p-1 text-xs text-text-dim hover:bg-background-secondary hover:text-text-primary"
              title="Edit"
            >
              ✎
            </button>
            <button
              onClick={() => onDelete?.(message.id)}
              className="rounded p-1 text-xs text-text-dim hover:bg-status-dnd/20 hover:text-status-dnd"
              title="Delete"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group relative flex gap-3 py-2 px-2 hover:bg-background-secondary/50 transition-colors mt-2"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-background-tertiary text-sm font-semibold text-text-primary">
        {message.authorName.charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm text-text-primary">
            {message.authorName}
          </span>
          <span className="text-[10px] text-text-dim">
            {formatTime(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-[10px] text-text-dim">(edited)</span>
          )}
        </div>

        {isEditing ? (
          <EditMessageInput
            initialContent={message.content}
            onSave={handleEditSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="text-sm text-text-primary leading-relaxed">
            <MarkdownContent content={message.content} mentionNames={[]} />
          </div>
        )}

        {/* Reactions (TASK-0030) */}
        <ReactionBar
          messageId={message.id}
          reactions={reactions}
          onReactionsChange={setReactions}
          apiBasePath={`/api/dms/${dmId}/messages`}
        />
      </div>

      {/* Actions */}
      {isHovering && !isEditing && isOwnMessage && (
        <div className="absolute -top-2 right-2 flex gap-1 rounded border border-border bg-background-primary p-0.5 shadow-sm">
          <button
            onClick={() => setIsEditing(true)}
            className="rounded p-1 text-xs text-text-dim hover:bg-background-secondary hover:text-text-primary"
            title="Edit"
          >
            ✎
          </button>
          <button
            onClick={() => onDelete?.(message.id)}
            className="rounded p-1 text-xs text-text-dim hover:bg-status-dnd/20 hover:text-status-dnd"
            title="Delete"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
