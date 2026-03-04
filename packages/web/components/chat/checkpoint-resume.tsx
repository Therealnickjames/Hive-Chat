"use client";

import { useState, useCallback } from "react";
import { useChatContext } from "@/components/providers/chat-provider";

interface CheckpointEntry {
  index: number;
  label: string;
  contentOffset: number;
  timestamp: string;
}

interface CheckpointResumeProps {
  messageId: string;
  channelId: string;
  checkpoints: CheckpointEntry[];
  onResume?: (
    messageId: string,
    checkpointIndex: number,
    botId: string,
  ) => void;
}

/**
 * Resume from checkpoint UI for ERROR streaming messages. (TASK-0021)
 *
 * Shows checkpoint markers and allows resuming from any checkpoint
 * with a different bot/model selection.
 */
export function CheckpointResume({
  messageId,
  channelId,
  checkpoints,
  onResume,
}: CheckpointResumeProps) {
  const { bots } = useChatContext();
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<number>(
    checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].index : 0,
  );
  const [selectedBotId, setSelectedBotId] = useState<string>(
    bots.length > 0 ? bots[0].id : "",
  );
  const [isResuming, setIsResuming] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleResume = useCallback(async () => {
    if (!selectedBotId || isResuming) return;
    setIsResuming(true);

    try {
      if (onResume) {
        onResume(messageId, selectedCheckpoint, selectedBotId);
      }
    } finally {
      setIsResuming(false);
      setShowPicker(false);
    }
  }, [messageId, selectedCheckpoint, selectedBotId, isResuming, onResume]);

  if (checkpoints.length === 0) return null;

  const activeBots = bots.filter((b) => b.isActive !== false);

  return (
    <div className="mt-2">
      {!showPicker ? (
        <button
          onClick={() => setShowPicker(true)}
          className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition flex items-center gap-1"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Resume from checkpoint
        </button>
      ) : (
        <div className="rounded-lg border border-accent/30 bg-background-secondary p-3">
          <div className="text-xs font-mono text-accent mb-2">
            RESUME FROM CHECKPOINT
          </div>

          {/* Checkpoint selector */}
          <div className="mb-2">
            <label className="text-xs text-text-muted block mb-1">
              Checkpoint
            </label>
            <select
              value={selectedCheckpoint}
              onChange={(e) =>
                setSelectedCheckpoint(parseInt(e.target.value, 10))
              }
              className="w-full text-sm bg-background-primary border border-border rounded px-2 py-1 text-text-primary"
            >
              {checkpoints.map((cp) => (
                <option key={cp.index} value={cp.index}>
                  #{cp.index + 1}: {cp.label}
                </option>
              ))}
            </select>
          </div>

          {/* Bot/model selector */}
          <div className="mb-3">
            <label className="text-xs text-text-muted block mb-1">
              Resume with
            </label>
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="w-full text-sm bg-background-primary border border-border rounded px-2 py-1 text-text-primary"
            >
              {activeBots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleResume}
              disabled={isResuming || !selectedBotId}
              className="text-xs px-3 py-1 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition"
            >
              {isResuming ? "Resuming..." : "Resume"}
            </button>
            <button
              onClick={() => setShowPicker(false)}
              className="text-xs px-3 py-1 rounded bg-background-tertiary text-text-secondary hover:bg-background-primary transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
