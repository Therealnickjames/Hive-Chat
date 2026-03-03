import { test, expect, type Page, type Browser } from "@playwright/test";
import { login } from "./helpers";

// ---------------------------------------------------------------------------
// Seed data — must match prisma/seed.mjs
// ---------------------------------------------------------------------------
const DEMO_USER = { email: "demo@tavok.ai", password: "DemoPass123!" };
const ALICE = { email: "alice@tavok.ai", password: "DemoPass123!" };
const BOB = { email: "bob@tavok.ai", password: "DemoPass123!" };

/**
 * Navigate to a specific channel by clicking through the sidebar.
 */
async function openChannel(page: Page, channelName: string): Promise<void> {
  await page.getByText("CHANNELS", { exact: true }).click();

  const channelButton = page.locator("button").filter({
    has: page.locator(`text="${channelName}"`),
  });
  await channelButton.first().click();

  await expect(
    page.getByPlaceholder(`Message #${channelName}`),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Select the seeded server "AI Research Lab" from the sidebar.
 */
async function selectServer(page: Page): Promise<void> {
  await page.getByText("SERVERS", { exact: true }).click();
  await page.getByText("AI Research Lab").click();
  // Small wait for channels to load
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Real-time messaging", () => {
  test("message from user A appears for user B in real-time", async ({
    browser,
  }) => {
    // Create two isolated browser contexts (separate sessions)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // Login both users
      await login(pageA, ALICE.email, ALICE.password);
      await login(pageB, BOB.email, BOB.password);

      // Both navigate to the same server
      await selectServer(pageA);
      await selectServer(pageB);

      // Both open #general channel
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");

      // User A sends a unique message
      const uniqueMessage = `Realtime test ${Date.now()}`;
      const inputA = pageA.getByPlaceholder("Message #general");
      await inputA.fill(uniqueMessage);
      await inputA.press("Enter");

      // User A should see their own message
      await expect(pageA.getByText(uniqueMessage)).toBeVisible({
        timeout: 10_000,
      });

      // User B should see the message appear WITHOUT refreshing
      // (via WebSocket / Phoenix Channel real-time push)
      await expect(pageB.getByText(uniqueMessage)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("message from user B is visible to user A in real-time", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await login(pageA, DEMO_USER.email, DEMO_USER.password);
      await login(pageB, BOB.email, BOB.password);

      await selectServer(pageA);
      await selectServer(pageB);

      await openChannel(pageA, "general");
      await openChannel(pageB, "general");

      // Give WebSocket connections a moment to fully establish
      await pageA.waitForTimeout(1_000);
      await pageB.waitForTimeout(1_000);

      // User B sends a message
      const msg = `Bob realtime ${Date.now()}`;
      const inputB = pageB.getByPlaceholder("Message #general");
      await inputB.fill(msg);
      await inputB.press("Enter");

      // Verify user B sees their own message
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      // Verify user A sees it via real-time push
      await expect(pageA.getByText(msg)).toBeVisible({ timeout: 15_000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("typing indicator shows when another user is typing", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await login(pageA, ALICE.email, ALICE.password);
      await login(pageB, BOB.email, BOB.password);

      await selectServer(pageA);
      await selectServer(pageB);

      await openChannel(pageA, "general");
      await openChannel(pageB, "general");

      // User A starts typing (triggers onTyping callback)
      const inputA = pageA.getByPlaceholder("Message #general");
      await inputA.pressSequentially("Hello from Alice", { delay: 50 });

      // User B should see a typing indicator showing Alice is typing.
      // The typing indicator renders: "{displayName} is typing..."
      // Alice's display name from the seed is "Alice Chen"
      await expect(
        pageB.getByText(/Alice Chen is typing/),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("multiple messages arrive in correct order", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await login(pageA, ALICE.email, ALICE.password);
      await login(pageB, BOB.email, BOB.password);

      await selectServer(pageA);
      await selectServer(pageB);

      await openChannel(pageA, "general");
      await openChannel(pageB, "general");

      // Give WebSocket connections time to establish
      await pageA.waitForTimeout(1_000);
      await pageB.waitForTimeout(1_000);

      const ts = Date.now();
      const msg1 = `Order test 1 - ${ts}`;
      const msg2 = `Order test 2 - ${ts}`;
      const msg3 = `Order test 3 - ${ts}`;

      const inputA = pageA.getByPlaceholder("Message #general");

      // Send three messages in succession with pauses for DB ordering
      await inputA.fill(msg1);
      await inputA.press("Enter");
      await expect(pageA.getByText(msg1)).toBeVisible({ timeout: 10_000 });

      await inputA.fill(msg2);
      await inputA.press("Enter");
      await expect(pageA.getByText(msg2)).toBeVisible({ timeout: 10_000 });

      await inputA.fill(msg3);
      await inputA.press("Enter");
      await expect(pageA.getByText(msg3)).toBeVisible({ timeout: 10_000 });

      // Wait for all messages to appear on user B's screen
      await expect(pageB.getByText(msg1)).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText(msg2)).toBeVisible({ timeout: 10_000 });
      await expect(pageB.getByText(msg3)).toBeVisible({ timeout: 10_000 });

      // Verify ordering: get the full page HTML and check that msg1
      // appears before msg2, which appears before msg3
      const pageContent = await pageB.content();
      const idx1 = pageContent.indexOf(msg1);
      const idx2 = pageContent.indexOf(msg2);
      const idx3 = pageContent.indexOf(msg3);
      expect(idx1).toBeGreaterThan(-1);
      expect(idx2).toBeGreaterThan(-1);
      expect(idx3).toBeGreaterThan(-1);
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
