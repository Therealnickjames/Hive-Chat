/**
 * Shared types for the Add Agent modal components.
 * DEC-0047: Multi-method agent onboarding
 */

export type ConnectionMethodType =
  | "WEBSOCKET"
  | "WEBHOOK"
  | "INBOUND_WEBHOOK"
  | "REST_POLL"
  | "SSE"
  | "OPENAI_COMPAT";

export type ModalView =
  | "list"
  | "method-picker"
  | "byok-form"
  | "sdk-setup"
  | "inbound-webhook-form"
  | "outbound-webhook-form"
  | "rest-form"
  | "sse-form"
  | "openai-form"
  | "credentials"
  | "settings";

export interface AgentListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  llmProvider: string;
  llmModel: string;
  apiEndpoint: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  triggerMode: string;
  thinkingSteps: string | null;
  connectionMethod: ConnectionMethodType | null; // null = BYOK
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | null; // null = BYOK
  capabilities: unknown;
  createdAt: string;
}

export interface CreatedAgentCredentials {
  id: string;
  name: string;
  connectionMethod: ConnectionMethodType;
  apiKey?: string;
  webhookSecret?: string;
  webhookUrl?: string;
  webhookToken?: string;
  websocketUrl?: string;
  pollUrl?: string;
  eventsUrl?: string;
  chatCompletionsUrl?: string;
  modelsUrl?: string;
}

/** Human-readable labels + descriptions for each connection method */
export const METHOD_INFO: {
  key: ConnectionMethodType | "BYOK";
  title: string;
  description: string;
  view: ModalView;
}[] = [
  {
    key: "BYOK",
    title: "Bring Your Own Key",
    description: "Connect to any LLM provider with your API key",
    view: "byok-form",
  },
  {
    key: "WEBSOCKET",
    title: "Python / TS SDK",
    description: "Connect a custom agent via WebSocket",
    view: "sdk-setup",
  },
  {
    key: "INBOUND_WEBHOOK",
    title: "Inbound Webhook",
    description: "POST messages from curl, CI/CD, n8n, Zapier",
    view: "inbound-webhook-form",
  },
  {
    key: "WEBHOOK",
    title: "HTTP Webhook (Outbound)",
    description: "Tavok calls your agent's URL when triggered",
    view: "outbound-webhook-form",
  },
  {
    key: "REST_POLL",
    title: "REST Polling",
    description: "Agent polls for messages (Lambda, serverless)",
    view: "rest-form",
  },
  {
    key: "SSE",
    title: "Server-Sent Events",
    description: "Receive events real-time, send via REST",
    view: "sse-form",
  },
  {
    key: "OPENAI_COMPAT",
    title: "OpenAI-Compatible",
    description: "Works with LiteLLM, LangChain, any OpenAI SDK",
    view: "openai-form",
  },
];

/** Badge color for connection methods */
export function getMethodBadgeClasses(method: ConnectionMethodType | null): string {
  switch (method) {
    case null:
      return "bg-emerald-600/20 text-emerald-400"; // BYOK
    case "WEBSOCKET":
      return "bg-accent-cyan/20 text-accent-cyan";
    case "WEBHOOK":
      return "bg-orange-600/20 text-orange-400";
    case "INBOUND_WEBHOOK":
      return "bg-purple-600/20 text-purple-400";
    case "REST_POLL":
      return "bg-blue-600/20 text-blue-400";
    case "SSE":
      return "bg-green-600/20 text-green-400";
    case "OPENAI_COMPAT":
      return "bg-brand/20 text-brand";
    default:
      return "bg-background-tertiary text-text-muted";
  }
}

/** Short label for connection method badge */
export function getMethodLabel(method: ConnectionMethodType | null): string {
  switch (method) {
    case null:
      return "BYOK";
    case "WEBSOCKET":
      return "SDK";
    case "WEBHOOK":
      return "Webhook";
    case "INBOUND_WEBHOOK":
      return "Inbound";
    case "REST_POLL":
      return "REST";
    case "SSE":
      return "SSE";
    case "OPENAI_COMPAT":
      return "OpenAI";
    default:
      return "Unknown";
  }
}
