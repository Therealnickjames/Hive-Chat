import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  ALICE,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
  createTwoUserContexts,
  cleanupContexts,
} from "./helpers";

/** Open the emoji picker on a specific message. */
async function openEmojiPicker(
  page: import("@playwright/test").Page,
  messageText: string,
): Promise<void> {
  const msgContainer = page
    .locator("div.group.flex.gap-4.px-4")
    .filter({ hasText: messageText })
    .first();
  await msgContainer.hover();

  const addReactionButton = msgContainer.locator(
    'button[title="Add reaction"]',
  );
  await addReactionButton.click({ force: true, timeout: 5_000 });
  await expect(page.locator(".grid.grid-cols-5")).toBeVisible({
    timeout: 3_000,
  });
}

test.describe("Section 10: Emoji Reactions", () => {
  test("click reaction button — emoji picker opens", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("Picker-test");
    await sendMessage(page, "general", msg);
    await openEmojiPicker(page, msg);

    // Verify emoji picker has buttons
    const emojiButtons = page.locator(".grid.grid-cols-5 button");
    await expect(emojiButtons.first()).toBeVisible();
  });

  test("select emoji — reaction pill appears with count 1", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("React-add");
    await sendMessage(page, "general", msg);
    await openEmojiPicker(page, msg);

    // Click fire emoji
    await page
      .locator(".grid.grid-cols-5 button")
      .filter({ hasText: "🚀" })
      .click({ force: true });
    await page.waitForTimeout(1_500);

    // Verify reaction badge with count 1
    const msgContainer = page
      .locator("div.group.flex.gap-4.px-4")
      .filter({ hasText: msg })
      .first();
    const reactionBadge = msgContainer.locator("button.rounded-full.px-2");
    await expect(reactionBadge.first()).toBeVisible({ timeout: 5_000 });
    await expect(reactionBadge.first()).toContainText("1");
  });

  test("second user clicks same reaction — count goes to 2", async ({
    browser,
  }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      DEMO_USER,
      ALICE,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      // User A sends and reacts
      const msg = uniqueMsg("React-count");
      await sendMessage(pageA, "general", msg);
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      await openEmojiPicker(pageA, msg);
      await pageA
        .locator(".grid.grid-cols-5 button")
        .filter({ hasText: "🚀" })
        .click({ force: true });
      await pageA.waitForTimeout(1_500);

      // User B clicks the same reaction badge
      await pageB.waitForTimeout(2_000);
      const msgContainerB = pageB
        .locator("div.group.flex.gap-4.px-4")
        .filter({ hasText: msg })
        .first();
      const reactionBadge = msgContainerB
        .locator("button.rounded-full.px-2")
        .first();
      await expect(reactionBadge).toBeVisible({ timeout: 10_000 });
      await reactionBadge.click();
      await pageB.waitForTimeout(1_500);

      // Count should now be 2
      await expect(reactionBadge).toContainText("2", { timeout: 5_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("click own reaction again — toggles off", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("React-toggle");
    await sendMessage(page, "general", msg);
    await openEmojiPicker(page, msg);

    // Add reaction
    await page
      .locator(".grid.grid-cols-5 button")
      .filter({ hasText: "👍" })
      .click({ force: true });
    await page.waitForTimeout(1_500);

    // Verify badge appeared
    const msgContainer = page
      .locator("div.group.flex.gap-4.px-4")
      .filter({ hasText: msg })
      .first();
    const reactionBadge = msgContainer
      .locator("button.rounded-full.px-2")
      .first();
    await expect(reactionBadge).toBeVisible({ timeout: 5_000 });

    // Click to toggle off
    await reactionBadge.click();
    await page.waitForTimeout(1_500);

    // Badge should disappear
    await expect(msgContainer.locator("button.rounded-full.px-2")).toHaveCount(
      0,
      { timeout: 5_000 },
    );
  });
});
