"use client";

import { useState, useCallback } from "react";
import type { CodeBlockContent } from "@tavok/shared/typed-messages";

interface CodeBlockMessageProps {
  content: CodeBlockContent;
}

export function CodeBlockMessage({ content }: CodeBlockMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content.code]);

  return (
    <div className="rounded border border-border bg-background-primary my-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-background-secondary/50 border-b border-border">
        <div className="flex items-center gap-2">
          {content.filename && (
            <span className="text-[11px] font-mono text-text-secondary">
              {content.filename}
            </span>
          )}
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            {content.language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-background-secondary"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {/* Code */}
      <pre className="px-3 py-2 overflow-x-auto">
        <code className="text-[12px] font-mono text-text-primary leading-relaxed whitespace-pre">
          {content.code}
        </code>
      </pre>
    </div>
  );
}
