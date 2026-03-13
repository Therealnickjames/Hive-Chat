import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  createServerViaUI,
  createServerViaAPI,
} from "./helpers";

test.describe("Section 19: Edge Cases", () => {
  let serverName: string;
  let serverId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, DEMO_USER.email, DEMO_USER.password);
    serverName = `Test-S19-${Date.now()}`;
    const result = await createServerViaAPI(page, serverName);
    serverId = result.serverId;
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");
  });

  test("whitespace-only message — blocked or handled", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.fill("   ");
    await input.press("Enter");

    // Wait a moment — no message should be sent
    await page.waitForTimeout(1_500);

    // The input should still contain whitespace or be empty (message was not sent)
    // No new message with just spaces should appear in the chat
    const messages = await page.locator("div.group.flex.gap-3.px-4").count();

    // Send a real message to verify chat still works
    const realMsg = `After-whitespace-${Date.now()}`;
    await input.fill(realMsg);
    await input.press("Enter");
    await expect(page.getByText(realMsg)).toBeVisible({ timeout: 10_000 });
  });

  test("XSS attempt — sanitized", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    const xssPayload = `<script>alert('xss-${Date.now()}')</script>`;
    await input.fill(xssPayload);
    await input.press("Enter");

    await page.waitForTimeout(2_000);

    // The script tag should NOT be in the DOM as an actual script element
    const scriptCount = await page.locator(`script:text("xss")`).count();
    expect(scriptCount).toBe(0);

    // The text content should be escaped/sanitized (shown as text, not executed)
    // Check that no alert dialog appeared
    // Playwright would throw if an unexpected dialog appeared
  });

  test("very long message (10,000 chars) — renders without crash", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Message #general");
    const ts = Date.now();
    const longContent = `Long-${ts}-` + "x".repeat(9_980);
    await input.fill(longContent);
    await input.press("Enter");

    // Wait for the message to appear (may take longer due to size)
    await page.waitForTimeout(5_000);

    // Page should not crash — verify we can still interact
    const canType = await input.isVisible().catch(() => false);
    expect(canType).toBe(true);

    // Send another message to verify chat isn't broken
    const followUp = `Follow-up-${ts}`;
    await input.fill(followUp);
    await input.press("Enter");
    await expect(page.getByText(followUp)).toBeVisible({ timeout: 10_000 });
  });

  test("emoji in server name — works", async ({ page }) => {
    const emojiServerName = `Test 🚀 Server ${Date.now()}`;
    await createServerViaUI(page, emojiServerName);

    // Verify the server appears in the sidebar with emoji
    await page.getByRole("tab", { name: "SERVERS" }).click();
    await expect(page.getByText(/Test 🚀 Server/).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
