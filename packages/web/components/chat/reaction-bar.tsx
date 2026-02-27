"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { ReactionData } from "@/lib/hooks/use-channel";

const EMOJI_PRESETS = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🔥",
  "👀",
  "🚀",
  "💯",
  "✅",
  "❌",
  "🤔",
  "👏",
  "💜",
];

interface ReactionBarProps {
  messageId: string;
  reactions: ReactionData[];
  onReactionsChange: (reactions: ReactionData[]) => void;
}

export function ReactionBar({
  messageId,
  reactions,
  onReactionsChange,
}: ReactionBarProps) {
  const { data: session } = useSession();
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const currentUserId = session?.user?.id;

  const toggleReaction = useCallback(
    async (emoji: string) => {
      if (!currentUserId || loading) return;
      setLoading(true);

      const existingReaction = reactions.find((reaction) => reaction.emoji === emoji);
      const hasReacted = existingReaction?.userIds.includes(currentUserId);

      let optimisticReactions: ReactionData[];
      if (hasReacted) {
        optimisticReactions = reactions
          .map((reaction) => {
            if (reaction.emoji === emoji) {
              return {
                ...reaction,
                count: reaction.count - 1,
                userIds: reaction.userIds.filter((id) => id !== currentUserId),
              };
            }
            return reaction;
          })
          .filter((reaction) => reaction.count > 0);
      } else if (existingReaction) {
        optimisticReactions = reactions.map((reaction) => {
          if (reaction.emoji === emoji) {
            return {
              ...reaction,
              count: reaction.count + 1,
              userIds: [...reaction.userIds, currentUserId],
            };
          }
          return reaction;
        });
      } else {
        optimisticReactions = [
          ...reactions,
          { emoji, count: 1, userIds: [currentUserId] },
        ];
      }

      onReactionsChange(optimisticReactions);

      try {
        const method = hasReacted ? "DELETE" : "POST";
        const res = await fetch(`/api/messages/${messageId}/reactions`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        });

        if (res.ok) {
          const data = await res.json();
          onReactionsChange(data.reactions || []);
        } else {
          onReactionsChange(reactions);
        }
      } catch {
        onReactionsChange(reactions);
      } finally {
        setLoading(false);
        setShowPicker(false);
      }
    },
    [currentUserId, loading, messageId, onReactionsChange, reactions]
  );

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const hasReacted = currentUserId
          ? reaction.userIds.includes(currentUserId)
          : false;

        return (
          <button
            key={reaction.emoji}
            onClick={() => toggleReaction(reaction.emoji)}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition ${
              hasReacted
                ? "bg-brand/20 text-text-primary ring-1 ring-brand"
                : "bg-background-tertiary text-text-muted hover:bg-background-primary"
            }`}
          >
            <span>{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </button>
        );
      })}

      <div className="relative">
        <button
          onClick={() => setShowPicker((prev) => !prev)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-background-tertiary text-text-muted opacity-0 transition hover:bg-background-primary hover:text-text-primary group-hover:opacity-100"
          title="Add reaction"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>

        {showPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
            <div className="absolute bottom-full left-0 z-50 mb-1 rounded-lg border border-background-tertiary bg-background-floating p-2 shadow-xl">
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_PRESETS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(emoji)}
                    className="flex h-8 w-8 items-center justify-center rounded text-base transition hover:bg-background-primary"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
