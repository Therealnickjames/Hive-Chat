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
import { UserProfileCard } from "@/components/user/user-profile-card";
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
  const [profileCard, setProfileCard] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const handleAuthorClick = useCallback(
    (e: React.MouseEvent) => {
      if (message.authorType !== "USER") return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setProfileCard({ top: rect.bottom + 4, left: rect.left });
    },
    [message.authorType],
  );

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
        <div className="group mx-2 flex gap-3 rounded-md px-4 py-1">
          <div className="w-9 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] italic text-text-dim">
              [message deleted]
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="group mx-2 mt-[14px] flex gap-3 rounded-md px-4 py-2">
        <div className="flex-shrink-0 pt-0.5">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-background-elevated text-[12px] font-semibold text-text-dim">
            ?
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[12px] font-medium text-text-muted">
              {message.authorName}
            </span>
            <span className="text-[10px] text-text-dim">
              {formatTime(message.createdAt)}
            </span>
          </div>
          <p className="text-[12px] italic text-text-dim">[message deleted]</p>
        </div>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div className="group relative mx-2 flex gap-3 rounded-md px-4 py-0.5 transition-colors hover:bg-white/[0.01]">
        <div className="w-9 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <EditMessageInput
              initialContent={message.content}
              onSave={handleEditSave}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <div className="text-[12.5px] leading-[1.65] text-text-secondary">
              <MarkdownContent content={text} mentionNames={mentionNames} />
              {message.editedAt && (
                <span className="text-[10px] text-text-dim font-mono ml-1">
                  (edited)
                </span>
              )}
            </div>
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
    <div className="group relative mx-2 mt-[14px] flex gap-3 rounded-md px-4 py-2 transition-colors hover:bg-white/[0.01]">
      {/* Avatar */}
      <div
        className={`flex-shrink-0 pt-0.5 ${!isAgent ? "cursor-pointer" : ""}`}
        onClick={!isAgent ? handleAuthorClick : undefined}
      >
        {message.authorAvatarUrl ? (
          <Image
            src={message.authorAvatarUrl}
            alt={message.authorName}
            loader={passthroughImageLoader}
            unoptimized
            width={34}
            height={34}
            className="h-[34px] w-[34px] rounded-full object-cover"
          />
        ) : (
          <div
            className={`flex h-[34px] w-[34px] items-center justify-center rounded-full text-[12px] font-semibold ${isAgent ? "bg-background-elevated text-text-secondary" : "bg-background-elevated text-text-secondary"}`}
          >
            {message.authorName?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-[12px] font-medium ${isAgent ? "text-text-primary" : "text-text-primary cursor-pointer hover:underline"}`}
            onClick={!isAgent ? handleAuthorClick : undefined}
            data-testid="message-author-name"
          >
            {message.authorName}
          </span>
          {isAgent && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] bg-accent-cyan/10 text-accent-cyan-dim">
              AGENT
            </span>
          )}
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
          <div className="text-[12.5px] leading-[1.65] text-text-secondary">
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
      {profileCard && !isAgent && (
        <UserProfileCard
          userId={message.authorId}
          anchorRect={profileCard}
          onClose={() => setProfileCard(null)}
        />
      )}
    </div>
  );
}
