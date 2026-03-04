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
  const { members, bots } = useChatContext();
  const [isEditing, setIsEditing] = useState(false);

  const mentionNames = useMemo(
    () => [
      ...members.map((member) => member.displayName),
      ...bots.map((bot) => bot.name),
    ],
    [members, bots],
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

  const isBot = message.authorType === "BOT";
  const isAuthor = currentUserId === message.authorId;

  // Edit: only author of non-bot, non-deleted messages
  const canEdit = isAuthor && !isBot && !message.isDeleted;
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
        <div className="group flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 border-l-2 border-transparent">
          <div className="w-10 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-mono text-text-muted italic">
              [message deleted]
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="group mt-3 flex gap-4 px-4 py-2 hover:bg-background-secondary/50 border-l-2 border-transparent">
        <div className="flex-shrink-0 pt-0.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-background-secondary border border-border text-text-dim text-sm font-bold font-mono">
            ?
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-bold font-mono text-text-muted">
              {message.authorName}
            </span>
            <span className="text-[10px] text-text-muted font-mono">
              {formatTime(message.createdAt)}
            </span>
          </div>
          <p className="text-sm font-mono text-text-muted italic">
            [message deleted]
          </p>
        </div>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div
        className={`group relative flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 ${!isBot ? "border-l-2 border-transparent hover:border-brand/30 bg-transparent" : "border-l-2 border-transparent"}`}
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
      className={`group relative mt-3 flex gap-4 px-4 py-2 hover:bg-background-secondary/50 ${!isBot ? "border-l-2 border-brand bg-brand/5" : "border-l-2 border-transparent"}`}
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
            className={`flex h-10 w-10 items-center justify-center rounded-sm text-sm font-bold font-mono ${isBot ? "bg-background-secondary border border-accent-cyan text-accent-cyan" : "bg-background-secondary border border-brand text-brand"}`}
          >
            {message.authorName?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-sm font-bold font-mono ${isBot ? "text-accent-cyan" : "text-brand"}`}
          >
            {!isBot && <span className="mr-1 opacity-70">▸</span>}
            {message.authorName}
          </span>
          {isBot && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
              AGENT
            </span>
          )}
          <span className="text-[10px] text-text-muted font-mono">
            {formatTime(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-[10px] text-text-muted font-mono">
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
          <div className="text-sm font-mono text-text-primary leading-relaxed">
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
