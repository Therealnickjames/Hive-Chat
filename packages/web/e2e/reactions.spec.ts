import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

// ---------------------------------------------------------------------------
// Seed data — must match prisma/seed.mjs
// ---------------------------------------------------------------------------
const DEMO_USER = { email: "demo@tavok.ai", password: "DemoPass123!" };
const ALICE = { email: "alice@tavok.ai", password: "DemoPass123!" };

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

async function selectServer(page: Page): Promise<void> {
  await page.getByText("SERVERS", { exact: true }).click();
  await page.getByText("AI Research Lab").click();
  await page.waitForTimeout(500);
}

/**
 * Send a unique message and wait for it to appear in the message list.
 * Returns the message text for later reference.
 */
async function sendTestMessage(
  page: Page,
  channelName: string,
): Promise<string> {
  const testMessage = `Reaction test msg ${Date.now()}`;
  const messageInput = page.getByPlaceholder(`Message #${channelName}`);
  await messageInput.fill(testMessage);
  await messageInput.press("Enter");

  await expect(page.getByText(testMessage)).toBeVisible({ timeout: 10_000 });
  return testMessage;
}

/**
 * Find the message container (the .group div containing the text) and
 * open the emoji picker. Uses force:true to click the opacity-0 button.
 */
async function openEmojiPickerOnMessage(
  page: Page,
  messageText: string,
): Promise<void> {
  // Find the specific message's .group container
  // Message items use .group class: `div.group.flex.gap-4.px-4`
  const messageContainer = page
    .locator("div.group.flex.gap-4.px-4")
    .filter({ hasText: messageText })
    .first();

  // Hover to trigger group-hover:opacity-100 on the add-reaction button
  await messageContainer.hover();

  // Click the "Add reaction" button (opacity-0 → group-hover:opacity-100)
  // Use force:true because Playwright may still consider it non-actionable
  const addReactionButton = messageContainer.locator('button[title="Add reaction"]');
  await addReactionButton.click({ force: true, timeout: 5_000 });

  // The emoji picker grid should appear
  await expect(page.locator(".grid.grid-cols-8")).toBeVisible({
    timeout: 3_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Reactions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    // Give WebSocket connection time to fully establish
    await page.waitForTimeout(1_000);
  });

  test("reaction badge is visible on messages with reactions", async ({ page }) => {
    // Send a message and add a reaction so we can verify badge rendering
    const msg = await sendTestMessage(page, "general");
    await openEmojiPickerOnMessage(page, msg);

    // Click the fire emoji (avoid compound emojis like ❤️)
    await page
      .locator(".grid.grid-cols-8 button")
      .filter({ hasText: "🔥" })
      .click({ force: true });
    await page.waitForTimeout(1_500);

    // Verify the reaction badge is visible with emoji and count
    const messageContainer = page
      .locator("div.group.flex.gap-4.px-4")
      .filter({ hasText: msg })
      .first();

    const reactionBadge = messageContainer.locator("button.rounded-full.px-2");
    await expect(reactionBadge.first()).toBeVisible({ timeout: 5_000 });

    // Verify it shows a count of "1"
    await expect(reactionBadge.first()).toContainText("1");
  });

  test("can open the emoji picker on a message", async ({ page }) => {
    // Send a new message so we don't depend on scrolling to seeded messages
    const msg = await sendTestMessage(page, "general");

    // Open the emoji picker on our message
    await openEmojiPickerOnMessage(page, msg);

    // Verify the emoji picker grid is visible with emoji buttons
    const emojiGrid = page.locator(".grid.grid-cols-8");
    await expect(emojiGrid).toBeVisible();

    // Verify it contains emoji buttons (16 presets)
    const emojiButtons = emojiGrid.locator("button");
    await expect(emojiButtons).toHaveCount(16);
  });

  test("add a reaction to a new message", async ({ page }) => {
    // Send a fresh message so we can add a reaction to it
    const msg = await sendTestMessage(page, "general");

    // Open the emoji picker on our message
    await openEmojiPickerOnMessage(page, msg);

    // Click the fire emoji (🔥) — use its text content to find it
    await page
      .locator(".grid.grid-cols-8 button")
      .filter({ hasText: "🔥" })
      .click();

    // After clicking, the picker should close and a reaction badge should appear.
    // Wait for the API round-trip.
    await page.waitForTimeout(1_500);

    // Verify: the message container should now have a reaction badge
    const messageContainer = page
      .locator("div.group.flex.gap-4.px-4")
      .filter({ hasText: msg })
      .first();

    const reactionBadge = messageContainer.locator("button.rounded-full.px-2");
    await expect(reactionBadge.first()).toBeVisible({ timeout: 5_000 });
  });

  test("toggle reaction off by clicking it again", async ({ page }) => {
    // Send a message
    const msg = await sendTestMessage(page, "general");

    // Add a reaction
    await openEmojiPickerOnMessage(page, msg);

    // Click the thumbs-up emoji (force:true to bypass pointer event interception
    // from adjacent emoji buttons in the absolutely-positioned grid)
    await page
      .locator(".grid.grid-cols-8 button")
      .filter({ hasText: "👍" })
      .click({ force: true });
    await page.waitForTimeout(1_500);

    // Verify the reaction badge appeared
    const messageContainer = page
      .locator("div.group.flex.gap-4.px-4")
      .filter({ hasText: msg })
      .first();

    const reactionBadge = messageContainer.locator("button.rounded-full.px-2").first();
    await expect(reactionBadge).toBeVisible({ timeout: 5_000 });

    // Click the reaction badge to toggle it off
    await reactionBadge.click();
    await page.waitForTimeout(1_500);

    // The reaction badge should disappear (count was 1, now 0)
    await expect(
      messageContainer.locator("button.rounded-full.px-2"),
    ).toHaveCount(0, { timeout: 5_000 });
  });

  test("reaction appears for second user in real-time", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // Login both users
      await login(pageA, DEMO_USER.email, DEMO_USER.password);
      await login(pageB, ALICE.email, ALICE.password);

      // Both navigate to #general
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");

      // Give WebSocket connections time to establish
      await pageA.waitForTimeout(1_000);
      await pageB.waitForTimeout(1_000);

      // User A sends a message
      const msg = `Reaction RT ${Date.now()}`;
      const inputA = pageA.getByPlaceholder("Message #general");
      await inputA.fill(msg);
      await inputA.press("Enter");

      // Wait for both users to see it
      await expect(pageA.getByText(msg)).toBeVisible({ timeout: 10_000 });
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      // User A adds a reaction via emoji picker
      await openEmojiPickerOnMessage(pageA, msg);
      await pageA
        .locator(".grid.grid-cols-8 button")
        .filter({ hasText: "🔥" })
        .click();
      await pageA.waitForTimeout(1_500);

      // User B should see the reaction appear via WebSocket broadcast
      const msgContainerB = pageB
        .locator("div.group.flex.gap-4.px-4")
        .filter({ hasText: msg })
        .first();
      await expect(
        msgContainerB.locator("button.rounded-full.px-2"),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
