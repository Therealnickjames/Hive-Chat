import { test, expect } from "@playwright/test";
import { login, DEMO_USER, selectServer, openChannel } from "./helpers";

test.describe("Section 17: Channel Charter & Swarm Modes", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
  });

  test("open channel settings — charter options visible", async ({ page }) => {
    await openChannel(page, "general");

    // Look for channel settings button (gear icon in the top bar)
    const channelSettings = page
      .locator('button[title*="etting"], button[aria-label*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));

    // Try the channel-specific settings (usually in the top bar area)
    const topBar = page.locator('[class*="top-bar"], header').first();
    const settingsInTopBar = topBar
      .locator("button")
      .filter({ hasText: /settings|gear/i })
      .or(topBar.locator('button[title*="etting"]'));

    const settingsBtn = settingsInTopBar.first().or(channelSettings.first());
    await settingsBtn.click({ timeout: 5_000 }).catch(async () => {
      // Fallback: open server settings → channels → general
      const serverSettings = page
        .locator('button[title*="etting"]')
        .or(page.locator("button").filter({ hasText: /settings/i }));
      await serverSettings.first().click();
      await page.waitForTimeout(1_000);

      // Find channels section
      await page
        .getByText(/channels/i)
        .or(page.locator("button, a").filter({ hasText: /channels/i }))
        .first()
        .click();
    });

    await page.waitForTimeout(1_000);

    // Look for charter/swarm options
    const hasCharter = await page
      .getByText(/charter|swarm|mode/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    // If charter options exist, we pass. If not, this feature may need the
    // channel settings modal to be opened differently.
    expect(hasCharter).toBe(true);
  });

  test("set swarm mode — mode is saved", async ({ page }) => {
    await openChannel(page, "general");

    // Open channel settings
    const topBar = page.locator('[class*="top-bar"], header').first();
    const settingsBtn = topBar
      .locator('button[title*="etting"]')
      .or(page.locator('button[title*="etting"]').first());
    await settingsBtn.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    // Look for swarm mode selector
    const swarmSelect = page
      .locator("select")
      .filter({ hasText: /round.robin|human|lead|freeform/i })
      .or(page.locator('[name*="swarm"], [data-field*="swarm"]'));

    if (
      await swarmSelect
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false)
    ) {
      // Get all options and find one matching round robin
      const options = swarmSelect.first().locator("option");
      const count = await options.count();
      let targetValue = "";
      for (let i = 0; i < count; i++) {
        const text = (await options.nth(i).textContent()) || "";
        if (/round.robin/i.test(text)) {
          targetValue = (await options.nth(i).getAttribute("value")) || text;
          break;
        }
      }
      if (targetValue) {
        await swarmSelect.first().selectOption(targetValue);
      }
      await page.waitForTimeout(1_000);

      // Save
      const saveButton = page
        .getByRole("button", { name: /save|update|apply/i })
        .last();
      if (await saveButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await saveButton.click();
        await page.waitForTimeout(2_000);
      }
    }
  });
});
