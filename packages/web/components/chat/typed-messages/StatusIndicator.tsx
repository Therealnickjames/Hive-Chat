"use client";

import type { StatusContent } from "@tavok/shared/typed-messages";

interface StatusIndicatorProps {
  content: StatusContent;
}

const stateConfig: Record<string, { icon: string; color: string }> = {
  thinking: { icon: "\u{1F4AD}", color: "text-accent-cyan" },
  searching: { icon: "\u{1F50D}", color: "text-accent-cyan" },
  coding: { icon: "\u{1F4BB}", color: "text-accent-cyan" },
  reviewing: { icon: "\u{1F50E}", color: "text-accent-cyan" },
  done: { icon: "\u2713", color: "text-status-online" },
};

export function StatusIndicator({ content }: StatusIndicatorProps) {
  const config = stateConfig[content.state] || stateConfig.thinking;

  return (
    <div className="flex items-center gap-2 py-1 my-0.5">
      <span className={`text-xs ${config.color}`}>{config.icon}</span>
      <span
        className={`text-[11px] font-mono font-bold uppercase tracking-wider ${config.color}`}
      >
        {content.state}
      </span>
      {content.detail && (
        <span className="text-[11px] font-mono text-text-muted">
          {content.detail}
        </span>
      )}
    </div>
  );
}
