"use client";

import { useState, useMemo } from "react";
import type { ToolCallContent } from "@tavok/shared/typed-messages";

interface ToolCallCardProps {
  content: ToolCallContent;
}

const statusConfig = {
  pending: { label: "Pending", color: "text-text-muted", bg: "bg-background-secondary", icon: "\u25CB" },
  running: { label: "Running", color: "text-accent-cyan", bg: "bg-accent-cyan/10", icon: "\u25D4" },
  completed: { label: "Done", color: "text-status-online", bg: "bg-status-online/10", icon: "\u2713" },
  failed: { label: "Failed", color: "text-status-dnd", bg: "bg-status-dnd/10", icon: "\u2717" },
};

export function ToolCallCard({ content }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const status = statusConfig[content.status] || statusConfig.pending;

  const argsJson = useMemo(() => {
    try {
      return JSON.stringify(content.arguments, null, 2);
    } catch {
      return "{}";
    }
  }, [content.arguments]);

  const hasArgs = Object.keys(content.arguments || {}).length > 0;

  return (
    <div className={`rounded border ${content.status === "failed" ? "border-status-dnd/30" : "border-border"} ${status.bg} my-1`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        <span className={`text-xs font-mono ${status.color}`}>{status.icon}</span>
        <span className="text-xs font-bold font-mono text-text-secondary uppercase tracking-wider">
          {content.toolName}
        </span>
        <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${status.color}`}>
          {status.label}
        </span>
        {hasArgs && (
          <span className="text-[10px] text-text-muted font-mono">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        )}
      </button>
      {expanded && hasArgs && (
        <div className="px-3 pb-2 border-t border-border/50">
          <pre className="text-[11px] font-mono text-text-muted mt-2 overflow-x-auto whitespace-pre-wrap">
            {argsJson}
          </pre>
        </div>
      )}
    </div>
  );
}
