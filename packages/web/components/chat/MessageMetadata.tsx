"use client";

import { useState } from "react";

interface MessageMetadataProps {
  metadata: Record<string, unknown>;
}

/**
 * Collapsible metadata bar for agent messages.
 * Shows model, token counts, and latency in a compact inline format.
 * Renders below the message content when metadata is available.
 */
export function MessageMetadata({ metadata }: MessageMetadataProps) {
  const [expanded, setExpanded] = useState(false);

  const model = metadata.model as string | undefined;
  const provider = metadata.provider as string | undefined;
  const tokensIn = metadata.tokensIn as number | undefined;
  const tokensOut = metadata.tokensOut as number | undefined;
  const latencyMs = metadata.latencyMs as number | undefined;
  const costUsd = metadata.costUsd as number | undefined;

  // Build compact summary
  const parts: string[] = [];
  if (model) parts.push(model);
  if (tokensIn !== undefined || tokensOut !== undefined) {
    const total = (tokensIn || 0) + (tokensOut || 0);
    parts.push(`${total} tokens`);
  }
  if (latencyMs !== undefined) {
    parts.push(latencyMs > 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`);
  }

  if (parts.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[9px] font-mono text-text-muted hover:text-text-secondary hover:bg-background-secondary/50 transition-colors"
      >
        <span className="opacity-60">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>{parts.join(" \u00B7 ")}</span>
      </button>
      {expanded && (
        <div className="mt-1 ml-2 space-y-0.5">
          {provider && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Provider:</span> {provider}
            </div>
          )}
          {model && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Model:</span> {model}
            </div>
          )}
          {tokensIn !== undefined && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Input:</span> {tokensIn.toLocaleString()} tokens
            </div>
          )}
          {tokensOut !== undefined && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Output:</span> {tokensOut.toLocaleString()} tokens
            </div>
          )}
          {latencyMs !== undefined && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Latency:</span> {latencyMs > 1000 ? `${(latencyMs / 1000).toFixed(2)}s` : `${latencyMs}ms`}
            </div>
          )}
          {costUsd !== undefined && (
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Cost:</span> ${costUsd.toFixed(4)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
