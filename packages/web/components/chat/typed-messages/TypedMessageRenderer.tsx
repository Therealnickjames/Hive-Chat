"use client";

import { useMemo } from "react";
import type { MessagePayload } from "@/lib/hooks/use-channel";
import { ToolCallCard } from "./ToolCallCard";
import { ToolResultCard } from "./ToolResultCard";
import { CodeBlockMessage } from "./CodeBlockMessage";
import { ArtifactRenderer } from "./ArtifactRenderer";
import { StatusIndicator } from "./StatusIndicator";
import type {
  ToolCallContent,
  ToolResultContent,
  CodeBlockContent,
  ArtifactContent,
  StatusContent,
} from "@tavok/shared/typed-messages";

interface TypedMessageRendererProps {
  message: MessagePayload;
}

/**
 * Renders the content of a typed message based on its type.
 * Parses the JSON content and dispatches to the appropriate card component.
 * Falls back to raw content display if JSON parsing fails.
 */
export function TypedMessageRenderer({ message }: TypedMessageRendererProps) {
  const parsed = useMemo(() => {
    try {
      return typeof message.content === "string"
        ? JSON.parse(message.content)
        : message.content;
    } catch {
      return null;
    }
  }, [message.content]);

  if (!parsed) {
    // Fallback: render raw content as mono text
    return (
      <div className="text-xs font-mono text-text-muted">
        {message.content}
      </div>
    );
  }

  switch (message.type) {
    case "TOOL_CALL":
      return <ToolCallCard content={parsed as ToolCallContent} />;
    case "TOOL_RESULT":
      return <ToolResultCard content={parsed as ToolResultContent} />;
    case "CODE_BLOCK":
      return <CodeBlockMessage content={parsed as CodeBlockContent} />;
    case "ARTIFACT":
      return <ArtifactRenderer content={parsed as ArtifactContent} />;
    case "STATUS":
      return <StatusIndicator content={parsed as StatusContent} />;
    default:
      return (
        <div className="text-xs font-mono text-text-muted">
          {message.content}
        </div>
      );
  }
}
