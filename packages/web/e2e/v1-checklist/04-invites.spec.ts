import { test, expect } from "@playwright/test";
import {
  registerUser,
  SEED_SERVER,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
} from "./helpers";

test.describe("Section 4: Invite Links", () => {
  const ts = Date.now();

  test("full invite flow: register, accept invite, interact", async ({
    browser,
  }) => {
    // Register a brand new user
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    try {
      const userB = {
        email: `invite_${ts}@test.local`,
        username: `inv_${ts}`,
        displayName: `Invited User ${ts}`,
        password: "TestPass123!",
      };

      await registerUser(pageB, userB);

      // Wait for dashboard
      await expect(pageB.getByRole("tab", { name: "SERVERS" })).toBeVisible({
        timeout: 15_000,
      });

      // Navigate to invite URL using seeded invite code
      await pageB.goto("/invite/DEMO2026");
      await pageB.waitForTimeout(2_000);

      // Look for "Join" button or auto-accept
      const joinButton = pageB.getByRole("button", { name: /join/i });
      if (await joinButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await joinButton.click();
        await pageB.waitForTimeout(2_000);
      }

      // User B should now be in the server
      await pageB.getByRole("tab", { name: "SERVERS" }).click();
      await expect(pageB.getByText(SEED_SERVER).first()).toBeVisible({
        timeout: 10_000,
      });

      // User B can see channels
      await selectServer(pageB);
      await pageB.getByRole("tab", { name: "CHANNELS" }).click();
      await expect(
        pageB.locator("button").filter({ hasText: "general" }),
      ).toBeVisible({ timeout: 5_000 });

      // User B can send a message
      await openChannel(pageB, "general");
      await waitForWebSocket(pageB, "general");
      const msg = uniqueMsg("Invite test");
      await sendMessage(pageB, "general", msg);
    } finally {
      await contextB.close();
    }
  });
});
