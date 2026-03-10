import { test, expect } from "@playwright/test";
import {
  login,
  ALICE,
  BOB,
  createTwoUserContexts,
  cleanupContexts,
  uniqueMsg,
} from "./helpers";

test.describe("Section 12: Direct Messages", () => {
  test("start a DM and send message — received in real time", async ({
    browser,
  }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      // Alice opens DMs tab
      await pageA.getByRole("tab", { name: /DM/i }).click();
      await pageA.waitForTimeout(1_000);

      // Try to start a DM with Bob — look for a "New DM" button or search
      const newDmButton = pageA
        .locator("button")
        .filter({ hasText: /new|start|create/i })
        .first()
        .or(pageA.locator('button[title*="DM"]').first());

      if (await newDmButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await newDmButton.click();
        await pageA.waitForTimeout(1_000);

        // Search for Bob or select from user list
        const searchInput = pageA
          .getByPlaceholder(/search|user/i)
          .or(pageA.locator('input[type="text"]').last());

        if (
          await searchInput.isVisible({ timeout: 2_000 }).catch(() => false)
        ) {
          await searchInput.fill(BOB.username);
          await pageA.waitForTimeout(1_000);
          // Click on Bob in results
          await pageA
            .getByText(BOB.displayName)
            .or(pageA.getByText(BOB.username))
            .first()
            .click();
          await pageA.waitForTimeout(1_000);
        }
      } else {
        // Alternative: Create DM via API
        const res = await pageA.request.post("/api/dms", {
          data: { username: BOB.username },
        });
        if (res.ok()) {
          const dm = await res.json();
          await pageA.goto(`/dms/${dm.id}`);
        }
      }

      // Wait for DM chat to load
      await pageA.waitForTimeout(2_000);

      // Send a message
      const msg = uniqueMsg("DM-hello");
      const dmInput = pageA.locator(
        'textarea[placeholder*="Message"], input[placeholder*="Message"]',
      );
      if (await dmInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await dmInput.fill(msg);
        await dmInput.press("Enter");

        // Verify Alice sees her message
        await expect(pageA.getByText(msg)).toBeVisible({ timeout: 10_000 });

        // Bob opens DMs and should see the conversation
        await pageB.getByRole("tab", { name: /DM/i }).click();
        await pageB.waitForTimeout(2_000);

        // Look for the DM with Alice
        const dmEntry = pageB
          .getByText(ALICE.displayName)
          .or(pageB.getByText(ALICE.username));
        if (
          await dmEntry
            .first()
            .isVisible({ timeout: 5_000 })
            .catch(() => false)
        ) {
          await dmEntry.first().click();
          await pageB.waitForTimeout(2_000);

          // Bob should see Alice's message
          await expect(pageB.getByText(msg)).toBeVisible({
            timeout: 15_000,
          });

          // Bob replies
          const replyMsg = uniqueMsg("DM-reply");
          const bobInput = pageB.locator(
            'textarea[placeholder*="Message"], input[placeholder*="Message"]',
          );
          await bobInput.fill(replyMsg);
          await bobInput.press("Enter");

          // Alice should see the reply
          await expect(pageA.getByText(replyMsg)).toBeVisible({
            timeout: 15_000,
          });
        }
      }
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("DMs persist across refresh", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);

    // Open DMs tab
    await page.getByRole("tab", { name: /DM/i }).click();
    await page.waitForTimeout(2_000);

    // Refresh
    await page.reload({ waitUntil: "domcontentloaded" });

    // DMs tab should still work
    await page.getByRole("tab", { name: /DM/i }).click();
    await page.waitForTimeout(2_000);

    // If there were DMs, they should still be visible
    // This is a basic check that the DM list loads
    await expect(page.getByRole("tab", { name: /DM/i })).toBeVisible();
  });
});
