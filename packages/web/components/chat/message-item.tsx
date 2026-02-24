"use client";

import type { MessagePayload } from "@/lib/hooks/use-channel";

interface MessageItemProps {
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

export function MessageItem({ message, isGrouped }: MessageItemProps) {
  if (isGrouped) {
    return (
      <div className="group flex gap-4 px-4 py-0.5 hover:bg-background-primary/30">
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group mt-3 flex gap-4 px-4 py-0.5 hover:bg-background-primary/30">
      {/* Avatar */}
      <div className="flex-shrink-0 pt-0.5">
        {message.authorAvatarUrl ? (
          <img
            src={message.authorAvatarUrl}
            alt={message.authorName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${message.authorType === "BOT" ? "bg-emerald-600 text-white" : "bg-brand text-background-floating"}`}>
            {message.authorName?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${message.authorType === "BOT" ? "text-emerald-400" : "text-brand"}`}>
            {message.authorName}
          </span>
          {message.authorType === "BOT" && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600/20 text-emerald-400">
              BOT
            </span>
          )}
          <span className="text-xs text-text-muted">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
    </div>
  );
}
