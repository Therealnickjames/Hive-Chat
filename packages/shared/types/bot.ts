// Bot types — matches Prisma Bot model

export type TriggerMode = "ALWAYS" | "MENTION" | "KEYWORD";

export type LLMProvider =
  | "anthropic"
  | "openai"
  | "ollama"
  | "openrouter"
  | "custom";

export interface Bot {
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

/** Bot config as returned by internal API (includes decrypted API key) */
export interface BotConfig {
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
}
