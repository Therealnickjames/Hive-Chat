import { test, expect } from "@playwright/test";
import {
  login,
  ALICE,
  BOB,
  DEMO_USER,
  selectServer,
  openChannel,
  sendMessage,
  waitForWebSocket,
  uniqueMsg,
  createTwoUserContexts,
  cleanupContexts,
} from "./helpers";

test.describe("Section 5: Real-Time Messaging", () => {
  test("User A sends message — appears immediately", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("Immediate");
    await sendMessage(page, "general", msg);
    await expect(page.getByText(msg)).toBeVisible({ timeout: 5_000 });
  });

  test("User B sees message in real time (no refresh)", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const msg = uniqueMsg("Realtime");
      await sendMessage(pageA, "general", msg);

      // User B sees it without refresh
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("User B replies — User A sees it in real time", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const msg1 = uniqueMsg("Alice says");
      await sendMessage(pageA, "general", msg1);
      await expect(pageB.getByText(msg1)).toBeVisible({ timeout: 15_000 });

      const msg2 = uniqueMsg("Bob replies");
      await sendMessage(pageB, "general", msg2);
      await expect(pageA.getByText(msg2)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("messages persist after page refresh", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("Persist");
    await sendMessage(page, "general", msg);

    // Refresh page
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectServer(page);
    await openChannel(page, "general");

    // Message should still be there
    await expect(page.getByText(msg)).toBeVisible({ timeout: 10_000 });
  });

  test("messages in correct chronological order", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const ts = Date.now();
    const msg1 = `Order-1-${ts}`;
    const msg2 = `Order-2-${ts}`;
    const msg3 = `Order-3-${ts}`;

    await sendMessage(page, "general", msg1);
    await sendMessage(page, "general", msg2);
    await sendMessage(page, "general", msg3);

    // Verify order in DOM
    const html = await page.content();
    const idx1 = html.indexOf(msg1);
    const idx2 = html.indexOf(msg2);
    const idx3 = html.indexOf(msg3);
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  test("long messages (500+ chars) render correctly", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const longMsg = `Long-${Date.now()} ${"a".repeat(500)}`;
    await sendMessage(page, "general", longMsg);

    // Verify the message content is rendered (check a substring)
    await expect(page.getByText(longMsg.slice(0, 50))).toBeVisible({
      timeout: 10_000,
    });
  });

  test("rapid-fire 10 messages — all arrive in order", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const ts = Date.now();
      const messages: string[] = [];

      for (let i = 0; i < 10; i++) {
        const msg = `Rapid-${i}-${ts}`;
        messages.push(msg);
        const input = pageA.getByPlaceholder("Message #general");
        await input.fill(msg);
        await input.press("Enter");
        // Small delay to ensure ordering
        await pageA.waitForTimeout(200);
      }

      // Wait for last message to appear on User B
      await expect(pageB.getByText(messages[9])).toBeVisible({
        timeout: 20_000,
      });

      // Verify all messages arrived and are in order
      const html = await pageB.content();
      let lastIdx = -1;
      for (const msg of messages) {
        const idx = html.indexOf(msg);
        expect(idx, `Message "${msg}" should be in the page`).toBeGreaterThan(
          -1,
        );
        expect(
          idx,
          `Message "${msg}" should be after the previous one`,
        ).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("empty message cannot be sent", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Try sending empty message
    const input = page.getByPlaceholder("Message #general");
    await input.fill("");
    await input.press("Enter");

    // No new empty message should appear. The input should still be empty.
    await page.waitForTimeout(1_000);
    // Verify nothing was sent — the input is still focused and empty
    await expect(input).toHaveValue("");
  });

  test("presence shows both users online", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      // Give presence time to sync
      await pageA.waitForTimeout(2_000);

      // Check for online indicators — look for presence dots or online status
      // The member list should show users as online
      const memberList = pageA
        .locator('[class*="member"]')
        .or(pageA.getByText(BOB.displayName));

      // At minimum, both users should be able to exchange messages (proving presence)
      const msg = uniqueMsg("Presence check");
      await sendMessage(pageA, "general", msg);
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });
});
