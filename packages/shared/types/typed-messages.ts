// Typed message content shapes — TASK-0039
// Each MessageType has a corresponding content shape stored as JSON in Message.content
// See docs/PROTOCOL.md for full contract

// ---------- TOOL_CALL ----------
export interface ToolCallContent {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
}

// ---------- TOOL_RESULT ----------
export interface ToolResultContent {
  callId: string;
  result: unknown;
  error: string | null;
  durationMs: number;
}

// ---------- CODE_BLOCK ----------
export interface CodeBlockContent {
  language: string;
  code: string;
  filename?: string;
}

// ---------- ARTIFACT ----------
export interface ArtifactContent {
  artifactType: "html" | "svg" | "file";
  title: string;
  content: string;
}

// ---------- STATUS ----------
export interface StatusContent {
  state: "thinking" | "searching" | "coding" | "reviewing" | "done";
  detail: string;
}

// ---------- Message Metadata ----------
// Attached to agent messages (primarily STREAMING/COMPLETE) via Message.metadata
export interface MessageMetadataPayload {
  model?: string; // e.g. "claude-sonnet-4-20250514"
  provider?: string; // e.g. "anthropic"
  tokensIn?: number; // input tokens
  tokensOut?: number; // output tokens
  latencyMs?: number; // total wall time in ms
  costUsd?: number; // estimated cost in USD (optional)
}

// Union type for all typed message content
export type TypedMessageContent =
  | ToolCallContent
  | ToolResultContent
  | CodeBlockContent
  | ArtifactContent
  | StatusContent;

// Extended message types (added by TASK-0039)
export type ExtendedMessageType =
  | "STANDARD"
  | "STREAMING"
  | "SYSTEM"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "CODE_BLOCK"
  | "ARTIFACT"
  | "STATUS";
