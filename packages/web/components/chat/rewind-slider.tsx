"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MarkdownContent } from "./markdown-content";

interface TokenHistoryEntry {
  o: number; // content offset
  t: number; // relative ms from stream start
}

interface CheckpointEntry {
  index: number;
  label: string;
  contentOffset: number;
  timestamp: string;
}

interface RewindSliderProps {
  content: string;
  tokenHistory: TokenHistoryEntry[];
  checkpoints?: CheckpointEntry[];
  mentionNames?: string[];
  onClose: () => void;
}

/**
 * Stream rewind scrub slider for completed streaming messages. (TASK-0021)
 *
 * Allows replaying token accumulation at 1x or 2x speed, or scrubbing
 * to any point in the stream history. Checkpoint markers show key moments.
 */
export function RewindSlider({
  content,
  tokenHistory,
  checkpoints = [],
  mentionNames = [],
  onClose,
}: RewindSliderProps) {
  const [position, setPosition] = useState(tokenHistory.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const animFrameRef = useRef<number | null>(null);
  const playStartRef = useRef<{ time: number; position: number } | null>(null);

  // Compute visible content at current position
  const visibleContent = useMemo(() => {
    if (position >= tokenHistory.length - 1) return content;
    if (position < 0) return "";
    return content.substring(0, tokenHistory[position].o);
  }, [content, tokenHistory, position]);

  // Compute checkpoint positions as percentages on the slider
  const checkpointMarkers = useMemo(() => {
    if (checkpoints.length === 0 || tokenHistory.length === 0) return [];
    return checkpoints.map((cp) => {
      // Find the closest token history entry to this checkpoint's content offset
      let closest = 0;
      for (let i = 0; i < tokenHistory.length; i++) {
        if (tokenHistory[i].o >= cp.contentOffset) {
          closest = i;
          break;
        }
        closest = i;
      }
      return {
        ...cp,
        sliderPosition: closest,
        percentage: (closest / Math.max(tokenHistory.length - 1, 1)) * 100,
      };
    });
  }, [checkpoints, tokenHistory]);

  // Duration of the original stream in ms
  const totalDuration = useMemo(() => {
    if (tokenHistory.length === 0) return 0;
    return tokenHistory[tokenHistory.length - 1].t;
  }, [tokenHistory]);

  // Play animation using requestAnimationFrame
  const tick = useCallback(() => {
    if (!playStartRef.current) return;

    const elapsed = (performance.now() - playStartRef.current.time) * speed;
    const startT = tokenHistory[playStartRef.current.position]?.t || 0;
    const targetT = startT + elapsed;

    // Find the position that corresponds to targetT
    let newPos = playStartRef.current.position;
    for (let i = playStartRef.current.position; i < tokenHistory.length; i++) {
      if (tokenHistory[i].t <= targetT) {
        newPos = i;
      } else {
        break;
      }
    }

    setPosition(newPos);

    if (newPos >= tokenHistory.length - 1) {
      setIsPlaying(false);
      playStartRef.current = null;
      return;
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, [tokenHistory, speed]);

  // Start/stop play
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      playStartRef.current = null;
    } else {
      // If at end, restart from beginning
      const startPos = position >= tokenHistory.length - 1 ? 0 : position;
      setPosition(startPos);
      setIsPlaying(true);
      playStartRef.current = { time: performance.now(), position: startPos };
      animFrameRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying, position, tokenHistory.length, tick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Stop playing when speed changes
  useEffect(() => {
    if (isPlaying && playStartRef.current) {
      playStartRef.current = { time: performance.now(), position };
    }
  }, [speed, isPlaying, position]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newPos = parseInt(e.target.value, 10);
      setPosition(newPos);
      if (isPlaying) {
        setIsPlaying(false);
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        playStartRef.current = null;
      }
    },
    [isPlaying],
  );

  const currentTime = tokenHistory[position]?.t || 0;
  const progressPercent =
    tokenHistory.length > 1
      ? (position / (tokenHistory.length - 1)) * 100
      : 100;

  return (
    <div className="rounded-lg border border-accent/30 bg-background-secondary p-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent">REWIND</span>
          <span className="text-xs text-text-muted">
            {formatMs(currentTime)} / {formatMs(totalDuration)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="p-1 rounded hover:bg-background-tertiary text-text-secondary transition"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
          {/* Speed toggle */}
          <button
            onClick={() => setSpeed(speed === 1 ? 2 : 1)}
            className="px-1.5 py-0.5 rounded text-xs font-mono hover:bg-background-tertiary text-text-secondary transition"
            title={`Speed: ${speed}x`}
          >
            {speed}x
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-background-tertiary text-text-muted transition"
            title="Close rewind"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Slider with checkpoint markers */}
      <div className="relative mb-2">
        <input
          type="range"
          min={0}
          max={Math.max(tokenHistory.length - 1, 0)}
          value={position}
          onChange={handleSliderChange}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
            bg-background-tertiary
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-accent
            [&::-webkit-slider-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${progressPercent}%, var(--color-background-tertiary) ${progressPercent}%, var(--color-background-tertiary) 100%)`,
          }}
        />
        {/* Checkpoint dots */}
        {checkpointMarkers.map((cp) => (
          <div
            key={cp.index}
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-yellow-400 border border-background-secondary pointer-events-none"
            style={{ left: `${cp.percentage}%` }}
            title={cp.label}
          />
        ))}
      </div>

      {/* Checkpoint labels */}
      {checkpointMarkers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {checkpointMarkers.map((cp) => (
            <button
              key={cp.index}
              onClick={() => {
                setPosition(cp.sliderPosition);
                if (isPlaying) {
                  setIsPlaying(false);
                  if (animFrameRef.current)
                    cancelAnimationFrame(animFrameRef.current);
                  playStartRef.current = null;
                }
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 transition"
            >
              {cp.label}
            </button>
          ))}
        </div>
      )}

      {/* Content preview */}
      <div className="max-h-40 overflow-y-auto rounded bg-background-primary p-2 text-sm">
        {visibleContent ? (
          <MarkdownContent
            content={visibleContent}
            mentionNames={mentionNames}
          />
        ) : (
          <span className="text-text-muted italic">Start of stream</span>
        )}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
