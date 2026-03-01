"use client";

import { useMemo, useCallback } from "react";
import Image from "next/image";
import { useChatContext } from "@/components/providers/chat-provider";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MarkdownContent } from "./markdown-content";
import { ReactionBar } from "./reaction-bar";
import { FileAttachment, parseFileReferences } from "./file-attachment";
import { passthroughImageLoader } from "@/lib/image-loader";
import { formatTime } from "@/lib/format-time";

interface StreamingMessageProps {
  message: MessagePayload;
  isGrouped: boolean;
  onReactionsChange?: (messageId: string, reactions: ReactionData[]) => void;
}

/**
 * Renders a streaming agent message with:
 * - Pulse animation on avatar while ACTIVE
 * - Blinking cursor while streaming
 * - Error indicator on ERROR state
 * - Normal rendering when COMPLETE
 */
export function StreamingMessage({
  message,
  isGrouped,
  onReactionsChange,
}: StreamingMessageProps) {
  const { members, bots } = useChatContext();
  const mentionNames = useMemo(
    () => [...members.map((member) => member.displayName), ...bots.map((bot) => bot.name)],
    [members, bots]
  );
  const { text, files } = useMemo(
    () => parseFileReferences(message.content || ""),
    [message.content]
  );
  const handleReactionsChange = useCallback(
    (reactions: ReactionData[]) => {
      onReactionsChange?.(message.id, reactions);
    },
    [message.id, onReactionsChange]
  );
  const isActive = message.streamingStatus === "ACTIVE";
  const isError = message.streamingStatus === "ERROR";

  if (isGrouped) {
    return (
      <div className={`group flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 ${isActive ? 'bg-accent-cyan/5 border-l-2 border-accent-cyan/50' : 'border-l-2 border-transparent'}`}>
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono text-text-primary leading-relaxed">
            <MarkdownContent content={text} mentionNames={mentionNames} />
            {isActive && <span className="inline-block w-2 h-4 ml-1 bg-accent-cyan animate-pulse align-middle" />}
          </div>
          {files.map((file) => (
            <FileAttachment
              key={file.fileId}
              fileId={file.fileId}
              filename={file.filename}
              mimeType={file.mimeType}
            />
          ))}
          {isError && (
            <p className="text-xs text-status-dnd mt-1 font-mono">
              [SYSTEM: Stream ended with an error]
            </p>
          )}
          {!isActive && (
            <ReactionBar
              messageId={message.id}
              reactions={message.reactions || []}
              onReactionsChange={handleReactionsChange}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`group mt-3 flex gap-4 px-4 py-2 hover:bg-background-secondary/50 ${isActive ? 'bg-accent-cyan/5 border-l-2 border-accent-cyan' : 'border-l-2 border-transparent'}`}>
      {/* Avatar with pulse while streaming */}
      <div className="flex-shrink-0 pt-0.5">
        <div className="relative">
          {message.authorAvatarUrl ? (
            <Image
              src={message.authorAvatarUrl}
              alt={message.authorName}
              loader={passthroughImageLoader}
              unoptimized
              width={40}
              height={40}
              className="h-10 w-10 rounded-sm object-cover"
            />
          ) : (
            <div className={`flex h-10 w-10 items-center justify-center rounded-sm bg-background-secondary border ${isActive ? 'border-accent-cyan text-accent-cyan' : 'border-text-dim text-text-dim'} text-sm font-bold font-mono`}>
              {message.authorName?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
          {isActive && (
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-accent-cyan animate-pulse border-2 border-background-primary" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-sm font-bold font-mono ${isActive ? "text-accent-cyan" : "text-text-secondary"}`}>
            {message.authorName}
          </span>
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isActive ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30' : 'bg-background-secondary text-text-muted border border-border'}`}>
            AGENT
          </span>
          <span className="text-[10px] text-text-muted font-mono">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <div className="text-sm font-mono text-text-primary leading-relaxed">
          <MarkdownContent content={text} mentionNames={mentionNames} />
          {isActive && <span className="inline-block w-2 h-4 ml-1 bg-accent-cyan animate-pulse align-middle" />}
        </div>
        {files.map((file) => (
          <FileAttachment
            key={file.fileId}
            fileId={file.fileId}
            filename={file.filename}
            mimeType={file.mimeType}
          />
        ))}
        {isError && (
          <p className="text-xs text-status-dnd mt-1 font-mono">
            [SYSTEM: Stream ended with an error]
          </p>
        )}
        {!isActive && (
          <ReactionBar
            messageId={message.id}
            reactions={message.reactions || []}
            onReactionsChange={handleReactionsChange}
          />
        )}
      </div>
    </div>
  );
}
