"use client";

import type { CharterState } from "@/lib/hooks/use-channel";

// TASK-0020: Human-readable swarm mode labels
const SWARM_MODE_LABELS: Record<string, string> = {
  HUMAN_IN_THE_LOOP: "Human in the Loop",
  LEAD_AGENT: "Lead Agent",
  ROUND_ROBIN: "Round Robin",
  STRUCTURED_DEBATE: "Debate",
  CODE_REVIEW_SPRINT: "Code Review",
  FREEFORM: "Freeform",
  CUSTOM: "Custom",
};

interface ChannelHeaderProps {
  channelName: string;
  topic?: string | null;
  charterState?: CharterState | null; // TASK-0020
  onCharterPause?: () => void; // TASK-0020
  onCharterEnd?: () => void; // TASK-0020
}

export function ChannelHeader({
  channelName,
  topic,
  charterState,
  onCharterPause,
  onCharterEnd,
}: ChannelHeaderProps) {
  const isCharterActive =
    charterState &&
    (charterState.status === "ACTIVE" || charterState.status === "PAUSED");

  return (
    <div className="flex h-12 items-center border-b border-background-tertiary px-4">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xl text-text-muted">#</span>
        <h1 className="text-base font-bold text-text-primary">{channelName}</h1>
        {topic && !isCharterActive && (
          <>
            <div className="mx-2 h-5 w-px bg-background-tertiary" />
            <span className="truncate text-sm text-text-muted">{topic}</span>
          </>
        )}

        {/* TASK-0020: Charter status display */}
        {isCharterActive && (
          <>
            <div className="mx-2 h-5 w-px bg-background-tertiary" />
            <div className="flex items-center gap-2">
              {/* Status indicator */}
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  charterState.status === "ACTIVE"
                    ? "bg-status-success animate-pulse"
                    : "bg-status-warning"
                }`}
              />

              {/* Mode label */}
              <span className="text-xs font-medium text-accent-cyan">
                {SWARM_MODE_LABELS[charterState.swarmMode] ||
                  charterState.swarmMode}
              </span>

              {/* Turn counter */}
              {charterState.maxTurns > 0 && (
                <span className="text-xs text-text-muted">
                  Turn {charterState.currentTurn + 1}/{charterState.maxTurns}
                </span>
              )}

              {/* Control buttons */}
              {charterState.status === "ACTIVE" && onCharterPause && (
                <button
                  onClick={onCharterPause}
                  className="rounded px-2 py-0.5 text-[10px] font-medium text-text-muted bg-background-tertiary hover:bg-background-secondary hover:text-text-primary transition-colors"
                >
                  Pause
                </button>
              )}
              {charterState.status === "PAUSED" && (
                <span className="text-[10px] font-medium text-status-warning">
                  Paused
                </span>
              )}
              {onCharterEnd && (
                <button
                  onClick={onCharterEnd}
                  className="rounded px-2 py-0.5 text-[10px] font-medium text-text-muted bg-background-tertiary hover:bg-status-danger/20 hover:text-status-danger transition-colors"
                >
                  End
                </button>
              )}
            </div>
          </>
        )}

        {/* Completed charter indicator */}
        {charterState?.status === "COMPLETED" && (
          <>
            <div className="mx-2 h-5 w-px bg-background-tertiary" />
            <span className="text-xs text-text-muted">
              Charter completed ({charterState.currentTurn} turns)
            </span>
          </>
        )}
      </div>
    </div>
  );
}
