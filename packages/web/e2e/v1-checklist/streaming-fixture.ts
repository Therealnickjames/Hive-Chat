/**
 * Shared streaming test setup — provisions a mock agent that talks to
 * the mock LLM server on the host machine.
 *
 * Exported helpers:
 *   ensureMockLLM()        — starts the mock OpenAI server (singleton)
 *   ensureMockAgent(page)  — creates "Echo Test Agent" via API if needed
 *   cleanupMockLLM()       — stops the mock server
 *   MOCK_AGENT_NAME        — the agent display name to check in the UI
 */

import type { Page } from "@playwright/test";
import { startMockLLM, stopMockLLM } from "../mock-llm-server";

export const MOCK_AGENT_NAME = "Echo Test Agent";
const MOCK_LLM_PORT = 9999;

// Docker Desktop on Windows resolves this to the host machine
const MOCK_LLM_ENDPOINT = `http://host.docker.internal:${MOCK_LLM_PORT}`;

let mockLLMStarted = false;
let mockAgentCreated = false;

/**
 * Start the mock LLM server. Idempotent — only starts once per process.
 */
export async function ensureMockLLM(): Promise<void> {
  if (mockLLMStarted) return;
  await startMockLLM(MOCK_LLM_PORT);
  mockLLMStarted = true;
}

/**
 * Create the "Echo Test Agent" on the seed server via the authenticated
 * Next.js API. Uses the current page's session cookies for auth.
 *
 * The agent is created with:
 *   - llmProvider: "custom" (routes through OpenAI-compat provider in Go)
 *   - apiEndpoint: host.docker.internal:9999 (mock server on host)
 *   - triggerMode: "ALWAYS" (no @mention needed)
 *
 * Idempotent — only creates once per process.
 */
export async function ensureMockAgent(page: Page): Promise<void> {
  if (mockAgentCreated) return;

  // Get the server ID from the API
  const serversRes = await page.evaluate(async () => {
    const res = await fetch("/api/servers");
    return res.json();
  });

  const servers = serversRes.servers || serversRes;
  const server = Array.isArray(servers)
    ? servers.find((s: { name: string }) => s.name === "AI Research Lab")
    : null;

  if (!server) {
    throw new Error(
      "Could not find 'AI Research Lab' server. Is the database seeded?",
    );
  }

  // Check if agent already exists
  const agentsRes = await page.evaluate(async (sid: string) => {
    const res = await fetch(`/api/servers/${sid}/agents`);
    return res.json();
  }, server.id);

  const agents = agentsRes.agents || agentsRes;
  const existing = Array.isArray(agents)
    ? agents.find((a: { name: string }) => a.name === "Echo Test Agent")
    : null;

  if (existing) {
    mockAgentCreated = true;
    return;
  }

  // Create the BYOK agent
  const createRes = await page.evaluate(
    async (args: { serverId: string; endpoint: string }) => {
      const res = await fetch(`/api/servers/${args.serverId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Echo Test Agent",
          llmProvider: "custom",
          llmModel: "mock-echo",
          apiEndpoint: args.endpoint,
          apiKey: "mock-test-key",
          systemPrompt:
            "You are a test echo agent. Echo the user message back.",
          temperature: 0,
          maxTokens: 256,
          triggerMode: "ALWAYS",
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { serverId: server.id, endpoint: MOCK_LLM_ENDPOINT },
  );

  if (createRes.status !== 201 && createRes.status !== 200) {
    throw new Error(
      `Failed to create mock agent: ${createRes.status} — ${JSON.stringify(createRes.body)}`,
    );
  }

  mockAgentCreated = true;
}

/**
 * Stop the mock LLM server.
 */
export async function cleanupMockLLM(): Promise<void> {
  await stopMockLLM();
  mockLLMStarted = false;
}
