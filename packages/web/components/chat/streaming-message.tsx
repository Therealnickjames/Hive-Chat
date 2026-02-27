"use client";

import type { MessagePayload } from "@/lib/hooks/use-channel";
import { MarkdownContent } from "./markdown-content";

interface StreamingMessageProps {
  message: MessagePayload;
  isGrouped: boolean;
}

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Renders a streaming bot message with:
 * - Pulse animation on avatar while ACTIVE
 * - Blinking cursor while streaming
 * - Error indicator on ERROR state
 * - Normal rendering when COMPLETE
 */
export function StreamingMessage({ message, isGrouped }: StreamingMessageProps) {
  const isActive = message.streamingStatus === "ACTIVE";
  const isError = message.streamingStatus === "ERROR";

  if (isGrouped) {
    return (
      <div className="group flex gap-4 px-4 py-0.5 hover:bg-background-primary/30">
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div>
            <MarkdownContent content={message.content || ""} />
            {isActive && <span className="inline-block w-0.5 h-4 ml-0.5 bg-brand animate-pulse align-middle" />}
          </div>
          {isError && (
            <p className="text-xs text-status-danger mt-1">
              Stream ended with an error
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group mt-3 flex gap-4 px-4 py-0.5 hover:bg-background-primary/30">
      {/* Avatar with pulse while streaming */}
      <div className="flex-shrink-0 pt-0.5">
        <div className="relative">
          {message.authorAvatarUrl ? (
            <img
              src={message.authorAvatarUrl}
              alt={message.authorName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
              {message.authorName?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
          {isActive && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-brand animate-pulse border-2 border-background-secondary" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-emerald-400">
            {message.authorName}
          </span>
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600/20 text-emerald-400">
            BOT
          </span>
          <span className="text-xs text-text-muted">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <div>
          <MarkdownContent content={message.content || ""} />
          {isActive && <span className="inline-block w-0.5 h-4 ml-0.5 bg-brand animate-pulse align-middle" />}
        </div>
        {isError && (
          <p className="text-xs text-status-danger mt-1">
            Stream ended with an error
          </p>
        )}
      </div>
    </div>
  );
}
