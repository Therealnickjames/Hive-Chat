import { test, expect } from "@playwright/test";
import { login, DEMO_USER, selectServer, createServerViaAPI } from "./helpers";
import { ensureMockAgent, MOCK_AGENT_NAME } from "./streaming-fixture";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

test.describe("Section 18: Agent Sharing via Config Templates", () => {
  let serverName: string;
  let serverId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, DEMO_USER.email, DEMO_USER.password);
    serverName = `Test-S18-${Date.now()}`;
    const result = await createServerViaAPI(page, serverName);
    serverId = result.serverId;
    await ensureMockAgent(page, serverId);
    await ctx.close();
  });

  test("export agent template via API", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);

    // Get agent ID
    const agents = await page.evaluate(async (sid: string) => {
      const res = await fetch(`/api/servers/${sid}/agents`);
      return res.json();
    }, serverId);

    const agentList = Array.isArray(agents?.agents) ? agents.agents : agents;
    expect(agentList.length).toBeGreaterThan(0);
    const agentId = agentList[0].id;

    // Export
    const template = await page.evaluate(
      async (args: { sid: string; aid: string }) => {
        const res = await fetch(
          `/api/servers/${args.sid}/agents/${args.aid}/export`,
        );
        return { status: res.status, body: await res.json() };
      },
      { sid: serverId, aid: agentId },
    );

    expect(template.status).toBe(200);
    expect(template.body._tavokAgentTemplate).toBe(1);
    expect(template.body.name).toBe(MOCK_AGENT_NAME);
    expect(template.body.llmProvider).toBeTruthy();
    expect(template.body.llmModel).toBeTruthy();
    // Secrets must NOT be in the template
    expect(template.body.apiKeyEncrypted).toBeUndefined();
    expect(template.body.apiKey).toBeUndefined();
    expect(template.body.id).toBeUndefined();
    expect(template.body.serverId).toBeUndefined();
  });

  test("import agent template via API", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);

    const template = {
      _tavokAgentTemplate: 1,
      name: "Imported Agent",
      llmProvider: "anthropic",
      llmModel: "claude-sonnet-4-20250514",
      apiEndpoint: "https://api.anthropic.com",
      systemPrompt: "You are an imported test agent.",
      temperature: 0.5,
      maxTokens: 2048,
      triggerMode: "MENTION",
    };

    const result = await page.evaluate(
      async (args: { sid: string; tpl: typeof template }) => {
        const res = await fetch(`/api/servers/${args.sid}/agents/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: args.tpl }),
        });
        const text = await res.text();
        try {
          return { status: res.status, body: JSON.parse(text) };
        } catch {
          return { status: res.status, body: { _raw: text } };
        }
      },
      { sid: serverId, tpl: template },
    );

    expect(result.status).toBe(201);
    expect(result.body.name).toBe("Imported Agent");
    expect(result.body.llmProvider).toBe("anthropic");
    expect(result.body.temperature).toBe(0.5);
    expect(result.body.maxTokens).toBe(2048);
    expect(result.body.triggerMode).toBe("MENTION");
  });

  test("import rejects template without name", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);

    const result = await page.evaluate(async (sid: string) => {
      const res = await fetch(`/api/servers/${sid}/agents/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: { llmProvider: "openai" } }),
      });
      return { status: res.status, body: await res.json() };
    }, serverId);

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("name");
  });

  test("export and import buttons visible in manage agents modal", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);

    // The "Manage Agents" button is in the channel sidebar
    const manageBtn = page.locator("button").filter({
      has: page.locator('text="Manage Agents"'),
    });
    await expect(manageBtn.first()).toBeVisible({ timeout: 10_000 });
    await manageBtn.first().click();
    await page.waitForTimeout(1_000);

    // Export button should be visible for each agent
    const exportBtn = page.locator(`[data-testid^="agent-export-btn-"]`);
    await expect(exportBtn.first()).toBeVisible({ timeout: 5_000 });

    // Import button should be visible in the footer
    const importBtn = page.locator('[data-testid="agent-import-btn"]');
    await expect(importBtn).toBeVisible({ timeout: 5_000 });
  });

  test("import agent via file upload in UI", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);

    // Write a temporary template file
    const template = {
      _tavokAgentTemplate: 1,
      name: "File Imported Agent",
      llmProvider: "openai",
      llmModel: "gpt-4o",
      apiEndpoint: "https://api.openai.com",
      systemPrompt: "Imported via file upload test.",
      temperature: 0.8,
      maxTokens: 1024,
      triggerMode: "ALWAYS",
    };
    const tmpFile = path.join(
      os.tmpdir(),
      `tavok-agent-test-${Date.now()}.json`,
    );
    fs.writeFileSync(tmpFile, JSON.stringify(template, null, 2));

    try {
      // Open manage agents modal from sidebar
      const manageBtn = page.locator("button").filter({
        has: page.locator('text="Manage Agents"'),
      });
      await expect(manageBtn.first()).toBeVisible({ timeout: 10_000 });
      await manageBtn.first().click();
      await page.waitForTimeout(1_000);

      // Upload the file via hidden input
      const fileInput = page.locator('[data-testid="agent-import-input"]');
      await fileInput.setInputFiles(tmpFile);

      // Wait for the imported agent to appear in the list
      await expect(page.getByText("File Imported Agent")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("round-trip: export then import creates identical config", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);

    // Get agents list
    const agents = await page.evaluate(async (sid: string) => {
      const res = await fetch(`/api/servers/${sid}/agents`);
      return res.json();
    }, serverId);
    const agentList = Array.isArray(agents?.agents) ? agents.agents : agents;
    const original = agentList[0];

    // Export original
    const exported = await page.evaluate(
      async (args: { sid: string; aid: string }) => {
        const res = await fetch(
          `/api/servers/${args.sid}/agents/${args.aid}/export`,
        );
        return res.json();
      },
      { sid: serverId, aid: original.id },
    );

    // Import with modified name to avoid conflict
    exported.name = `${exported.name} (Copy)`;
    const imported = await page.evaluate(
      async (args: { sid: string; tpl: Record<string, unknown> }) => {
        const res = await fetch(`/api/servers/${args.sid}/agents/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: args.tpl }),
        });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { _raw: text };
        }
      },
      { sid: serverId, tpl: exported },
    );

    // Verify config matches (ignoring id, timestamps, name suffix)
    expect(imported.llmProvider).toBe(original.llmProvider);
    expect(imported.llmModel).toBe(original.llmModel);
    expect(imported.temperature).toBe(original.temperature);
    expect(imported.maxTokens).toBe(original.maxTokens);
  });
});
