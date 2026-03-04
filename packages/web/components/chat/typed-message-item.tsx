"use client";

import Image from "next/image";
import type { MessagePayload } from "@/lib/hooks/use-channel";
import { TypedMessageRenderer } from "./typed-messages/TypedMessageRenderer";
import { passthroughImageLoader } from "@/lib/image-loader";
import { formatTime } from "@/lib/format-time";

interface TypedMessageItemProps {
  message: MessagePayload;
  isGrouped: boolean;
}

/**
 * Renders a typed message (TOOL_CALL, TOOL_RESULT, CODE_BLOCK, ARTIFACT, STATUS)
 * with the agent's avatar and name header, delegating content rendering to
 * TypedMessageRenderer. (TASK-0039)
 */
export function TypedMessageItem({ message, isGrouped }: TypedMessageItemProps) {
  if (isGrouped) {
    return (
      <div className="group relative flex gap-4 px-4 py-0.5 hover:bg-background-secondary/50 border-l-2 border-transparent">
        <div className="w-10 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <TypedMessageRenderer message={message} />
        </div>
      </div>
    );
  }

  return (
    <div className="group relative mt-3 flex gap-4 px-4 py-2 hover:bg-background-secondary/50 border-l-2 border-transparent">
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
            className="h-10 w-10 rounded-sm object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-background-secondary border border-text-dim text-text-dim text-sm font-bold font-mono">
            {message.authorName?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-bold font-mono text-text-secondary">
            {message.authorName}
          </span>
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-background-secondary text-text-muted border border-border">
            AGENT
          </span>
          <span className="text-[10px] text-text-muted font-mono">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <TypedMessageRenderer message={message} />
      </div>
    </div>
  );
}
