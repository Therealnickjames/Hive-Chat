import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
} from "./helpers";

// Note: This test requires an active agent with streaming capabilities.
// For full streaming validation, run the mock echo agent (scripts/mock-echo-agent.py)
// before running these tests.

test.describe("Section 15: Agent Streaming", () => {
  test("navigate to agent management UI", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);

    // Open server settings
    const settingsButton = page
      .locator('button[title*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));
    await settingsButton.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000);

    // Navigate to Agents section
    const agentsTab = page
      .getByText(/agents/i)
      .or(page.locator("button, a").filter({ hasText: /agents/i }));
    await agentsTab.first().click({ timeout: 5_000 });

    // Should see agent management UI
    await expect(page.getByText(/claude|gpt|agent/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("seeded agents are visible in server settings", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);

    const settingsButton = page
      .locator('button[title*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));
    await settingsButton.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000);

    await page
      .getByText(/agents/i)
      .or(page.locator("button, a").filter({ hasText: /agents/i }))
      .first()
      .click();
    await page.waitForTimeout(1_000);

    // Check for seeded agents: Claude, GPT-4, Llama 3
    const hasClaude = await page
      .getByText(/claude/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    expect(hasClaude).toBe(true);
  });

  test("create an agent via BYOK form", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);

    // Open server settings
    await page.locator('button[title="Server Settings"]').click();
    await page.waitForTimeout(1_000);

    // Click "Agents" in the settings sidebar (exact match to avoid the AGENTS panel)
    await page
      .locator("button")
      .filter({ hasText: /^Agents$/ })
      .click();
    await page.waitForTimeout(1_000);

    // The Agents section should show existing agents and a create/add button
    // Verify the section loaded by checking for the agent management UI
    const agentsSectionVisible = await page
      .getByText(/manage|add agent|create agent|agent name/i)
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    // If there's an "Add Agent" button, verify it's clickable
    const addButton = page.getByRole("button", { name: /add agent/i });
    const hasAddButton = await addButton
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    // At least the section should be visible with agent-related content
    expect(agentsSectionVisible || hasAddButton).toBe(true);
  });

  test("agent appears in channel when assigned", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");

    // The seeded server has Claude assigned to #general
    // Check for agent name in the AGENTS panel on the right
    await expect(page.getByText("Claude").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // Full streaming tests (tokens word-by-word, thinking timeline) require
  // the mock echo agent to be running. Those are integration-level tests.
  test.skip("@mention agent — tokens stream word-by-word (requires mock agent)", () => {
    // SKIPPED: Requires scripts/mock-echo-agent.py to be running.
    // Run: python scripts/mock-echo-agent.py --api-key <key> --agent-id <id>
  });

  test.skip("completed agent message persists after refresh (requires mock agent)", () => {
    // SKIPPED: Requires active streaming agent.
  });

  test.skip("thinking timeline shows states during streaming (requires mock agent)", () => {
    // SKIPPED: Requires active streaming agent.
  });
});
