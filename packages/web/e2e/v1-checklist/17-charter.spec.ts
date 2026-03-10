import { test, expect } from "@playwright/test";
import { login, DEMO_USER, selectServer, openChannel } from "./helpers";

test.describe("Section 17: Channel Charter & Swarm Modes", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
  });

  test("open channel settings — swarm mode visible", async ({ page }) => {
    await openChannel(page, "general");

    // Open channel settings via the "Channel Settings" button in the top bar
    const settingsBtn = page.locator('button[title="Channel Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();

    // The modal should show "Swarm Mode" label (#general has 2+ agents: Claude + GPT-4)
    await expect(page.getByText("Swarm Mode")).toBeVisible({ timeout: 5_000 });
  });

  test("set swarm mode — mode is saved", async ({ page }) => {
    await openChannel(page, "general");

    // Open channel settings
    await page.locator('button[title="Channel Settings"]').click();
    await page.waitForTimeout(1_000);

    // The swarm mode select should be visible (2+ agents on #general)
    const swarmSelect = page.locator("select").first();
    await expect(swarmSelect).toBeVisible({ timeout: 5_000 });

    // Find and select "Round Robin"
    const options = swarmSelect.locator("option");
    const count = await options.count();
    let roundRobinValue = "";
    for (let i = 0; i < count; i++) {
      const text = (await options.nth(i).textContent()) || "";
      if (/round.robin/i.test(text)) {
        roundRobinValue = (await options.nth(i).getAttribute("value")) || text;
        break;
      }
    }

    expect(roundRobinValue).toBeTruthy();
    await swarmSelect.selectOption(roundRobinValue);

    // Save
    const saveButton = page
      .getByRole("button", { name: /save|update|apply/i })
      .last();
    await expect(saveButton).toBeVisible({ timeout: 3_000 });
    await saveButton.click();
    await page.waitForTimeout(2_000);

    // Reopen settings and verify the value persisted
    await page.locator('button[title="Channel Settings"]').click();
    await page.waitForTimeout(1_000);

    const reopenedSelect = page.locator("select").first();
    await expect(reopenedSelect).toBeVisible({ timeout: 5_000 });
    const selectedValue = await reopenedSelect.inputValue();
    expect(selectedValue).toBe("ROUND_ROBIN");
  });
});
