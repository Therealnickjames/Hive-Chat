"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { useChatContext } from "@/components/providers/chat-provider";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MarkdownContent } from "./markdown-content";
import { ReactionBar } from "./reaction-bar";
import { FileAttachment, parseFileReferences } from "./file-attachment";
import { MessageActions } from "./message-actions";
import { MessageMetadata } from "./MessageMetadata";
import { RewindSlider } from "./rewind-slider";
import { CheckpointResume } from "./checkpoint-resume";
import { passthroughImageLoader } from "@/lib/image-loader";
import { formatTime } from "@/lib/format-time";

interface StreamingMessageProps {
  message: MessagePayload;
  isGrouped: boolean;
  onReactionsChange?: (messageId: string, reactions: ReactionData[]) => void;
  onResumeStream?: (messageId: string, checkpointIndex: number, botId: string) => void;
  currentUserId?: string;
  canManageMessages?: boolean;
  onDelete?: (messageId: string) => void;
}

/**
 * Renders a streaming agent message with:
 * - Pulse animation on avatar while ACTIVE
 * - Blinking cursor while streaming
 * - Error indicator on ERROR state
 * - Normal rendering when COMPLETE
 * - Delete action on COMPLETE/ERROR for admins (no edit on bot messages) (TASK-0014)
 */
export function StreamingMessage({
  message,
  isGrouped,
  onReactionsChange,
  onResumeStream,
  canManageMessages,
  onDelete,
}: StreamingMessageProps) {
  const [showRewind, setShowRewind] = useState(false);
  const loggedErrorRenderIdsRef = useRef<Set<string>>(new Set());
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
  const isComplete = message.streamingStatus === "COMPLETE";
  const hasTimeline = message.thinkingTimeline && message.thinkingTimeline.length > 0;

  // Delete only when not actively streaming, not already deleted, and user has MANAGE_MESSAGES
  const canDelete = !isActive && !message.isDeleted && !!canManageMessages;

  useEffect(() => {
    if (!isError || loggedErrorRenderIdsRef.current.has(message.id)) return;
    loggedErrorRenderIdsRef.current.add(message.id);

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
        hypothesisId: "H5",
        location: "streaming-message.tsx:isErrorRender",
        message: "Streaming error message rendered",
        data: {
          messageId: message.id,
          contentLen: (message.content || "").length,
          hasApiKeyPhrase: (message.content || "").includes("API key"),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [isError, message.id, message.content]);

  // Deleted streaming message placeholder
  if (message.isDeleted) {
    if (isGrouped) {
      return (
        <div className="group flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 border-l-2 border-transparent">
          <div className="w-10 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-mono text-text-muted italic">[message deleted]</p>
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
          <p className="text-sm font-mono text-text-muted italic">[message deleted]</p>
        </div>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div className={`group relative flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 ${isActive ? 'bg-accent-cyan/5 border-l-2 border-accent-cyan/50' : 'border-l-2 border-transparent'}`}>
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {isActive && message.thinkingPhase && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              {message.thinkingPhase}
            </span>
          )}
          <div className="text-sm font-mono text-text-primary leading-relaxed">
            <MarkdownContent content={text} mentionNames={mentionNames} />
            {isActive && <span className="inline-block w-2 h-4 ml-1 bg-accent-cyan animate-pulse align-middle" />}
            {message.editedAt && (
              <span className="text-[10px] text-text-muted font-mono ml-1">(edited)</span>
            )}
          </div>
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
          {isError && (
            <p className="text-xs text-status-dnd mt-1 font-mono">
              [SYSTEM: Stream ended with an error]
            </p>
          )}
          {/* Stream rewind slider (TASK-0021) */}
          {isComplete && message.tokenHistory && message.tokenHistory.length > 0 && showRewind && (
            <RewindSlider
              content={message.content || ""}
              tokenHistory={message.tokenHistory}
              checkpoints={message.checkpoints}
              mentionNames={mentionNames}
              onClose={() => setShowRewind(false)}
            />
          )}
          {/* Rewind toggle button (TASK-0021) */}
          {isComplete && message.tokenHistory && message.tokenHistory.length > 0 && !showRewind && (
            <button
              onClick={() => setShowRewind(true)}
              className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-muted hover:text-accent hover:bg-accent/10 transition flex items-center gap-1"
              title="Rewind stream"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="19,20 9,12 19,4" />
                <line x1="5" y1="19" x2="5" y2="5" />
              </svg>
              Rewind
            </button>
          )}
          {/* Checkpoint resume (TASK-0021) */}
          {isError && message.checkpoints && message.checkpoints.length > 0 && (
            <CheckpointResume
              messageId={message.id}
              channelId={message.channelId}
              checkpoints={message.checkpoints}
              onResume={onResumeStream}
            />
          )}
          {hasTimeline && (
            <div className="flex items-center gap-1 mt-1.5">
              {message.thinkingTimeline!.map((entry, i) => {
                const isCurrent = isActive && i === message.thinkingTimeline!.length - 1;
                return (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="w-3 h-px bg-text-muted/30" />}
                    <span className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                      isCurrent
                        ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                        : 'bg-background-secondary text-text-muted border border-border'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${isCurrent ? 'bg-accent-cyan animate-pulse' : 'bg-accent-cyan/50'}`} />
                      {entry.phase}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {isComplete && message.metadata && (
            <MessageMetadata metadata={message.metadata} />
          )}
          {!isActive && (
            <ReactionBar
              messageId={message.id}
              reactions={message.reactions || []}
              onReactionsChange={handleReactionsChange}
            />
          )}
        </div>
        {canDelete && (
          <MessageActions
            canEdit={false}
            canDelete={canDelete}
            onEdit={() => {}}
            onDelete={() => onDelete?.(message.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`group relative mt-3 flex gap-4 px-4 py-2 hover:bg-background-secondary/50 ${isActive ? 'bg-accent-cyan/5 border-l-2 border-accent-cyan' : 'border-l-2 border-transparent'}`}>
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
          {isActive && message.thinkingPhase && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              {message.thinkingPhase}
            </span>
          )}
          {message.editedAt && (
            <span className="text-[10px] text-text-muted font-mono">(edited)</span>
          )}
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
            width={file.width}
            height={file.height}
          />
        ))}
        {isError && (
          <p className="text-xs text-status-dnd mt-1 font-mono">
            [SYSTEM: Stream ended with an error]
          </p>
        )}
        {/* Stream rewind slider (TASK-0021) */}
        {isComplete && message.tokenHistory && message.tokenHistory.length > 0 && showRewind && (
          <RewindSlider
            content={message.content || ""}
            tokenHistory={message.tokenHistory}
            checkpoints={message.checkpoints}
            mentionNames={mentionNames}
            onClose={() => setShowRewind(false)}
          />
        )}
        {/* Rewind toggle button (TASK-0021) */}
        {isComplete && message.tokenHistory && message.tokenHistory.length > 0 && !showRewind && (
          <button
            onClick={() => setShowRewind(true)}
            className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-muted hover:text-accent hover:bg-accent/10 transition flex items-center gap-1"
            title="Rewind stream"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19,20 9,12 19,4" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
            Rewind
          </button>
        )}
        {/* Checkpoint resume (TASK-0021) */}
        {isError && message.checkpoints && message.checkpoints.length > 0 && (
          <CheckpointResume
            messageId={message.id}
            channelId={message.channelId}
            checkpoints={message.checkpoints}
            onResume={onResumeStream}
          />
        )}
        {hasTimeline && (
          <div className="flex items-center gap-1 mt-1.5">
            {message.thinkingTimeline!.map((entry, i) => {
              const isCurrent = isActive && i === message.thinkingTimeline!.length - 1;
              return (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="w-3 h-px bg-text-muted/30" />}
                  <span className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                    isCurrent
                      ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                      : 'bg-background-secondary text-text-muted border border-border'
                  }`}>
                    <span className={`w-1 h-1 rounded-full ${isCurrent ? 'bg-accent-cyan animate-pulse' : 'bg-accent-cyan/50'}`} />
                    {entry.phase}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {isComplete && message.metadata && (
          <MessageMetadata metadata={message.metadata} />
        )}
        {!isActive && (
          <ReactionBar
            messageId={message.id}
            reactions={message.reactions || []}
            onReactionsChange={handleReactionsChange}
          />
        )}
      </div>
      {canDelete && (
        <MessageActions
          canEdit={false}
          canDelete={canDelete}
          onEdit={() => {}}
          onDelete={() => onDelete?.(message.id)}
        />
      )}
    </div>
  );
}
