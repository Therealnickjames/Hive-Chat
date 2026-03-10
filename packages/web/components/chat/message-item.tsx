"use client";

import { useMemo, useCallback, useState } from "react";
import Image from "next/image";
import { useChatContext } from "@/components/providers/chat-provider";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MarkdownContent } from "./markdown-content";
import { ReactionBar } from "./reaction-bar";
import { FileAttachment, parseFileReferences } from "./file-attachment";
import { MessageActions } from "./message-actions";
import { EditMessageInput } from "./edit-message-input";
import { passthroughImageLoader } from "@/lib/image-loader";
import { formatTime } from "@/lib/format-time";

interface MessageItemProps {
  message: MessagePayload;
  isGrouped: boolean;
  onReactionsChange?: (messageId: string, reactions: ReactionData[]) => void;
  currentUserId?: string;
  canManageMessages?: boolean;
  onEdit?: (messageId: string, content: string) => Promise<boolean>;
  onDelete?: (messageId: string) => void;
}

export function MessageItem({
  message,
  isGrouped,
  onReactionsChange,
  currentUserId,
  canManageMessages,
  onEdit,
  onDelete,
}: MessageItemProps) {
  const { members, agents } = useChatContext();
  const [isEditing, setIsEditing] = useState(false);

  const mentionNames = useMemo(
    () => [
      ...members.map((member) => member.displayName),
      ...agents.map((agent) => agent.name),
    ],
    [members, agents],
  );
  const { text, files } = useMemo(
    () => parseFileReferences(message.content || ""),
    [message.content],
  );
  const handleReactionsChange = useCallback(
    (reactions: ReactionData[]) => {
      onReactionsChange?.(message.id, reactions);
    },
    [message.id, onReactionsChange],
  );

  const isAgent = message.authorType === "AGENT";
  const isAuthor = currentUserId === message.authorId;

  // Edit: only author of non-agent, non-deleted messages
  const canEdit = isAuthor && !isAgent && !message.isDeleted;
  // Delete: author OR has MANAGE_MESSAGES, not already deleted
  const canDelete = (isAuthor || !!canManageMessages) && !message.isDeleted;

  const handleEditSave = useCallback(
    async (content: string) => {
      if (onEdit) {
        const success = await onEdit(message.id, content);
        if (success) setIsEditing(false);
      }
    },
    [message.id, onEdit],
  );

  // Deleted message placeholder
  if (message.isDeleted) {
    if (isGrouped) {
      return (
        <div className="group mx-2 flex gap-4 rounded-xl px-4 py-1 hover:bg-background-secondary/40">
          <div className="w-10 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm italic text-text-muted">[message deleted]</p>
          </div>
        </div>
      );
    }
    return (
      <div className="group mx-2 mt-3 flex gap-4 rounded-2xl border border-white/6 bg-background-floating/28 px-4 py-3 hover:bg-background-floating/42">
        <div className="flex-shrink-0 pt-0.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-background-secondary text-sm font-semibold text-text-dim">
            ?
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-semibold text-text-muted">
              {message.authorName}
            </span>
            <span className="text-[10px] font-mono text-text-muted">
              {formatTime(message.createdAt)}
            </span>
          </div>
          <p className="text-sm italic text-text-muted">[message deleted]</p>
        </div>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div
        className={`group relative mx-2 flex gap-4 rounded-xl px-4 py-1 transition-colors hover:bg-background-secondary/36 ${!isAgent ? "bg-transparent" : "bg-transparent"}`}
      >
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <EditMessageInput
              initialContent={message.content}
              onSave={handleEditSave}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <>
              <MarkdownContent content={text} mentionNames={mentionNames} />
              {message.editedAt && (
                <span className="text-[10px] text-text-muted font-mono ml-1">
                  (edited)
                </span>
              )}
            </>
          )}
          {files.map((file) => (
            <FileAttachment
              key={file.fileId}
              fileId={file.fileId}
              filename={file.filename}
              mimeType={file.mimeType}
              width={file.width}
              height={file.height}
            />
          ))}
          <ReactionBar
            messageId={message.id}
            reactions={message.reactions || []}
            onReactionsChange={handleReactionsChange}
          />
        </div>
        {!isEditing && (
          <MessageActions
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={() => setIsEditing(true)}
            onDelete={() => onDelete?.(message.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`group relative mx-2 mt-3 flex gap-4 rounded-[22px] border px-4 py-3 shadow-[0_12px_30px_rgba(3,9,22,0.18)] transition-colors hover:bg-background-floating/46 ${!isAgent ? "border-brand/20 bg-brand/10" : "border-accent-cyan/20 bg-background-floating/35"}`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 pt-0.5">
        {message.authorAvatarUrl ? (
          <Image
            src={message.authorAvatarUrl}
            alt={message.authorName}
            loader={passthroughImageLoader}
            unoptimized
            width={40}
            height={40}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${isAgent ? "border border-accent-cyan/20 bg-accent-cyan/10 text-accent-cyan" : "border border-brand/24 bg-brand/10 text-brand"}`}
          >
            {message.authorName?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-sm font-semibold ${isAgent ? "text-accent-cyan" : "text-orange-100"}`}
          >
            {!isAgent && <span className="mr-1 text-brand/80">&gt;</span>}
            {message.authorName}
          </span>
          {isAgent && (
            <span className="inline-flex items-center rounded-full border border-accent-cyan/20 bg-accent-cyan/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-accent-cyan">
              AGENT
            </span>
          )}
          <span className="text-[10px] font-mono text-text-muted">
            {formatTime(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-[10px] font-mono text-text-muted">
              (edited)
            </span>
          )}
        </div>
        {isEditing ? (
          <EditMessageInput
            initialContent={message.content}
            onSave={handleEditSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="text-sm leading-7 text-text-primary">
            <MarkdownContent content={text} mentionNames={mentionNames} />
          </div>
        )}
        {files.map((file) => (
          <FileAttachment
            key={file.fileId}
            fileId={file.fileId}
            filename={file.filename}
            mimeType={file.mimeType}
          />
        ))}
        <ReactionBar
          messageId={message.id}
          reactions={message.reactions || []}
          onReactionsChange={handleReactionsChange}
        />
      </div>
      {!isEditing && (
        <MessageActions
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => setIsEditing(true)}
          onDelete={() => onDelete?.(message.id)}
        />
      )}
    </div>
  );
}
