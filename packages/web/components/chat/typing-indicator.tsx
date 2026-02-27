"use client";

import type { TypingUser } from "@/lib/hooks/use-channel";

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) {
    // Keep the space reserved so the layout doesn't jump
    return <div className="h-6 px-4" />;
  }

  let text: string;
  if (typingUsers.length === 1) {
    text = `${typingUsers[0].displayName} is typing`;
  } else if (typingUsers.length === 2) {
    text = `${typingUsers[0].displayName} and ${typingUsers[1].displayName} are typing`;
  } else {
    text = "Several people are typing";
  }

  return (
    <div className="flex h-6 items-center gap-1.5 px-4">
      {/* Animated dots */}
      <span className="flex gap-0.5">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:0ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:150ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:300ms]" />
      </span>
      <span className="text-xs text-text-muted">
        {text}...
      </span>
    </div>
  );
}
