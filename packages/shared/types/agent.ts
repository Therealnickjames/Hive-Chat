// Agent types — matches Prisma Agent model

export type TriggerMode = "ALWAYS" | "MENTION" | "KEYWORD";

// Agent connection method — how an agent communicates with Tavok (DEC-0043)
export type ConnectionMethod =
  | "WEBSOCKET" // Phoenix Channel V2 (Python SDK, TS SDK)
  | "WEBHOOK" // Tavok calls agent's URL on trigger
  | "INBOUND_WEBHOOK" // Agent POSTs into Tavok (Discord pattern)
  | "REST_POLL" // Agent polls for messages
  | "SSE" // Agent receives via SSE, sends via REST
  | "OPENAI_COMPAT"; // OpenAI Chat Completions format

export type LLMProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "groq"
  | "mistral"
  | "moonshot"
  | "ollama"
  | "openrouter"
  | "custom";

export interface Agent {
  id: string; // ULID
  name: string;
  avatarUrl: string | null;
  serverId: string; // ULID
  llmProvider: LLMProvider;
  llmModel: string;
  apiEndpoint: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  triggerMode: TriggerMode;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Agent config as returned by internal API (includes decrypted API key) */
export interface AgentConfig {
  id: string;
  name: string;
  llmProvider: LLMProvider;
  llmModel: string;
  apiEndpoint: string;
  apiKey: string; // decrypted — INTERNAL USE ONLY
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  triggerMode: TriggerMode;
  connectionMethod?: ConnectionMethod; // DEC-0043
}
