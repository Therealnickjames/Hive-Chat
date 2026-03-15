// TODO(TASK-0021): Checkpoint resume UI (onResumeStream, CheckpointResume component)
// is implemented but the callback is never wired in message-list.tsx.
// Wire up once TASK-0021 (Stream Rewind + Checkpoints + Resume) is complete.
// The /api/internal/stream/resume endpoint is also ready but uncalled.
"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import { useChatContext } from "@/components/providers/chat-provider";
import type { MessagePayload, ReactionData } from "@/lib/hooks/use-channel";
import { MarkdownContent } from "./markdown-content";
import { ReactionBar } from "./reaction-bar";
import { FileAttachment, parseFileReferences } from "./file-attachment";
import { MessageActions } from "./message-actions";
import { MessageMetadata } from "./message-metadata";
import { RewindSlider } from "./rewind-slider";
import { CheckpointResume } from "./checkpoint-resume";
import { passthroughImageLoader } from "@/lib/image-loader";
import { formatTime } from "@/lib/format-time";

interface StreamingMessageProps {
  message: MessagePayload;
  isGrouped: boolean;
  onReactionsChange?: (messageId: string, reactions: ReactionData[]) => void;
  onResumeStream?: (
    messageId: string,
    checkpointIndex: number,
    agentId: string,
  ) => void;
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
 * - Delete action on COMPLETE/ERROR for admins (no edit on agent messages) (TASK-0014)
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
  const { members, agents } = useChatContext();
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
  const isActive = message.streamingStatus === "ACTIVE";
  const isError = message.streamingStatus === "ERROR";
  const isComplete = message.streamingStatus === "COMPLETE";
  const hasTimeline =
    message.thinkingTimeline && message.thinkingTimeline.length > 0;

  // Delete only when not actively streaming, not already deleted, and user has MANAGE_MESSAGES
  const canDelete = !isActive && !message.isDeleted && !!canManageMessages;

  // Deleted streaming message placeholder
  if (message.isDeleted) {
    if (isGrouped) {
      return (
        <div className="group mx-2 flex gap-3 px-4 py-0.5 border-l-2 border-transparent">
          <div className="w-9 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-text-dim italic">
              [message deleted]
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="group mx-2 mt-[14px] flex gap-3 px-4 py-2 border-l-2 border-transparent">
        <div className="flex-shrink-0 pt-0.5">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-background-elevated text-text-dim text-[12px] font-semibold">
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
          <p className="text-[12px] text-text-dim italic">[message deleted]</p>
        </div>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div
        className={`group relative mx-2 flex gap-3 px-4 py-0.5 transition-colors ${isActive ? "border-l-2 border-accent-cyan bg-accent-cyan/[0.02]" : "border-l-2 border-transparent hover:bg-white/[0.01]"}`}
      >
        <div className="w-9 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {isActive && message.thinkingPhase && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-accent-cyan/[0.06] text-accent-cyan mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              {message.thinkingPhase}
            </span>
          )}
          <div className="text-[12.5px] text-text-secondary leading-[1.65]">
            <MarkdownContent content={text} mentionNames={mentionNames} />
            {isActive && <span className="streaming-cursor" />}
            {message.editedAt && (
              <span className="text-[10px] text-text-muted font-mono ml-1">
                (edited)
              </span>
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
          {isComplete &&
            message.tokenHistory &&
            message.tokenHistory.length > 0 &&
            showRewind && (
              <RewindSlider
                content={message.content || ""}
                tokenHistory={message.tokenHistory}
                checkpoints={message.checkpoints}
                mentionNames={mentionNames}
                onClose={() => setShowRewind(false)}
              />
            )}
          {/* Rewind toggle button (TASK-0021) */}
          {isComplete &&
            message.tokenHistory &&
            message.tokenHistory.length > 0 &&
            !showRewind && (
              <button
                onClick={() => setShowRewind(true)}
                className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-muted hover:text-accent hover:bg-accent/10 transition flex items-center gap-1"
                title="Rewind stream"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
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
                const isCurrent =
                  isActive && i === message.thinkingTimeline!.length - 1;
                return (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="w-3 h-px bg-text-muted/30" />}
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wider ${
                        isCurrent
                          ? "bg-accent-cyan/[0.06] text-accent-cyan"
                          : "text-text-dim"
                      }`}
                    >
                      <span
                        className={`w-1 h-1 rounded-full ${isCurrent ? "bg-accent-cyan animate-pulse" : "bg-text-dim/50"}`}
                      />
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
    <div
      className={`group relative mx-2 mt-[14px] flex gap-3 px-4 py-2 transition-colors ${isActive ? "border-l-2 border-accent-cyan bg-accent-cyan/[0.02]" : "border-l-2 border-transparent hover:bg-white/[0.01]"}`}
    >
      {/* Avatar with pulse while streaming */}
      <div className="flex-shrink-0 pt-0.5">
        <div className="relative">
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
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-full text-[12px] font-semibold ${isActive ? "bg-background-elevated border border-accent-cyan/20 text-text-secondary" : "bg-background-elevated text-text-secondary"}`}
            >
              {message.authorName?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
          {isActive && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent-cyan animate-pulse border-2 border-background-floating" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className={`text-[12px] font-medium ${isActive ? "text-text-primary" : "text-text-primary"}`}
          >
            {message.authorName}
          </span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${isActive ? "bg-accent-cyan/10 text-accent-cyan" : "bg-accent-cyan/10 text-accent-cyan-dim"}`}
          >
            AGENT
          </span>
          <span className="text-[10px] text-text-dim">
            {formatTime(message.createdAt)}
          </span>
          {isActive && message.thinkingPhase && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-accent-cyan/[0.06] text-accent-cyan">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              {message.thinkingPhase}
            </span>
          )}
          {message.editedAt && (
            <span className="text-[10px] text-text-dim">(edited)</span>
          )}
        </div>
        <div className="text-[12.5px] text-text-secondary leading-[1.65]">
          <MarkdownContent content={text} mentionNames={mentionNames} />
          {isActive && <span className="streaming-cursor" />}
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
        {isComplete &&
          message.tokenHistory &&
          message.tokenHistory.length > 0 &&
          showRewind && (
            <RewindSlider
              content={message.content || ""}
              tokenHistory={message.tokenHistory}
              checkpoints={message.checkpoints}
              mentionNames={mentionNames}
              onClose={() => setShowRewind(false)}
            />
          )}
        {/* Rewind toggle button (TASK-0021) */}
        {isComplete &&
          message.tokenHistory &&
          message.tokenHistory.length > 0 &&
          !showRewind && (
            <button
              onClick={() => setShowRewind(true)}
              className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-muted hover:text-accent hover:bg-accent/10 transition flex items-center gap-1"
              title="Rewind stream"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
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
              const isCurrent =
                isActive && i === message.thinkingTimeline!.length - 1;
              return (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="w-3 h-px bg-text-muted/30" />}
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wider ${
                      isCurrent
                        ? "bg-accent-cyan/[0.06] text-accent-cyan"
                        : "text-text-dim"
                    }`}
                  >
                    <span
                      className={`w-1 h-1 rounded-full ${isCurrent ? "bg-accent-cyan animate-pulse" : "bg-text-dim/50"}`}
                    />
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
