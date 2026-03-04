"use client";

import { useState, useMemo } from "react";
import type { ToolResultContent } from "@tavok/shared/typed-messages";

interface ToolResultCardProps {
  content: ToolResultContent;
}

export function ToolResultCard({ content }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = content.error !== null;

  const resultJson = useMemo(() => {
    try {
      if (isError) return content.error || "Unknown error";
      return typeof content.result === "string"
        ? content.result
        : JSON.stringify(content.result, null, 2);
    } catch {
      return String(content.result);
    }
  }, [content.result, content.error, isError]);

  const durationStr = content.durationMs
    ? content.durationMs > 1000
      ? `${(content.durationMs / 1000).toFixed(1)}s`
      : `${content.durationMs}ms`
    : null;

  return (
    <div
      className={`rounded border ${isError ? "border-status-dnd/30 bg-status-dnd/5" : "border-border bg-status-online/5"} my-1`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        <span
          className={`text-xs font-mono ${isError ? "text-status-dnd" : "text-status-online"}`}
        >
          {isError ? "\u2717" : "\u2713"}
        </span>
        <span className="text-xs font-bold font-mono text-text-secondary">
          Result
        </span>
        {durationStr && (
          <span className="text-[9px] font-mono text-text-muted">
            {durationStr}
          </span>
        )}
        <span className="text-[10px] text-text-muted font-mono ml-auto">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/50">
          <pre
            className={`text-[11px] font-mono mt-2 overflow-x-auto whitespace-pre-wrap ${isError ? "text-status-dnd" : "text-text-muted"}`}
          >
            {resultJson}
          </pre>
        </div>
      )}
    </div>
  );
}
