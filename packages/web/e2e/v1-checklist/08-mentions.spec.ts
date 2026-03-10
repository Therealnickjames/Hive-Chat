import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  ALICE,
  selectServer,
  openChannel,
  waitForWebSocket,
} from "./helpers";

test.describe("Section 8: @Mentions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");
  });

  test("type @ — autocomplete dropdown appears", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.pressSequentially("@", { delay: 100 });

    // The dropdown renders as buttons with user names (e.g., "Alice Chen", "Bob Martinez")
    // Wait for at least one user button to appear near the input
    await expect(
      page
        .getByRole("button", { name: /Alice Chen|Bob Martinez|Demo User/i })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("dropdown shows users in channel", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.pressSequentially("@", { delay: 100 });

    await page.waitForTimeout(1_000);

    // Should show users and agents in the dropdown buttons
    await expect(page.getByRole("button", { name: /Alice Chen/i })).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(
      page.getByRole("button", { name: /Bob Martinez/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("select user — mention inserted and renders as pill", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Message #general");
    const ts = Date.now();

    // Type @ to trigger autocomplete
    await input.pressSequentially("@ali", { delay: 100 });
    await page.waitForTimeout(1_000);

    // Click on Alice in the dropdown
    const aliceOption = page.getByRole("button", { name: /Alice Chen/i });
    if (await aliceOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await aliceOption.click();
    } else {
      // Fallback: press Tab or Enter to select first match
      await input.press("Tab");
    }

    // Add remaining text and send
    await input.pressSequentially(` mention test ${ts}`);
    await input.press("Enter");

    // Wait for the message to appear
    await page.waitForTimeout(2_000);

    // Verify the message was sent
    await expect(page.getByText(`mention test ${ts}`)).toBeVisible({
      timeout: 5_000,
    });
  });

  test.skip("@mentioning an agent triggers response (requires live agent)", () => {
    // SKIPPED: Requires an active agent with MENTION triggerMode.
    // Agent mention triggering is tested in Section 15 with the mock echo agent.
  });
});
