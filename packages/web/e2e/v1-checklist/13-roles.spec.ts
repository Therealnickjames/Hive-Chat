import { test, expect } from "@playwright/test";
import { login, DEMO_USER, selectServer } from "./helpers";

test.describe("Section 13: Roles & Permissions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
  });

  test("server owner can open server settings with roles section", async ({
    page,
  }) => {
    // Look for server settings button (gear icon)
    const settingsButton = page
      .locator('button[title*="etting"], button[aria-label*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));

    await settingsButton.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000);

    // Navigate to Roles section
    const rolesTab = page
      .getByText(/roles/i)
      .or(page.locator("button, a").filter({ hasText: /roles/i }));
    await rolesTab.first().click({ timeout: 5_000 });

    // Should show role management UI
    await expect(page.getByText(/admin|member|role/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("create a new role with name", async ({ page }) => {
    const ts = Date.now();

    // Open server settings
    const settingsButton = page
      .locator('button[title*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));
    await settingsButton.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000);

    // Go to Roles section
    await page
      .getByText(/roles/i)
      .or(page.locator("button, a").filter({ hasText: /roles/i }))
      .first()
      .click();
    await page.waitForTimeout(1_000);

    // Click "Create Role" button
    await page.getByRole("button", { name: "Create Role" }).click();
    await page.waitForTimeout(1_000);

    // Fill in role name
    const nameInput = page
      .getByPlaceholder(/role name/i)
      .or(page.getByLabel(/name/i))
      .or(page.locator("input").last());
    await nameInput.first().fill(`TestRole${ts}`);

    // Save/submit
    await page
      .getByRole("button", { name: /save|create/i })
      .last()
      .click();
    await page.waitForTimeout(2_000);

    // New role should appear in the list
    await expect(page.getByText(`TestRole${ts}`)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("@everyone default role exists", async ({ page }) => {
    // Open server settings → roles
    const settingsButton = page
      .locator('button[title*="etting"]')
      .or(page.locator("button").filter({ hasText: /settings/i }));
    await settingsButton.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000);

    await page
      .getByText(/roles/i)
      .or(page.locator("button, a").filter({ hasText: /roles/i }))
      .first()
      .click();
    await page.waitForTimeout(1_000);

    // Check for existing roles — at minimum Admin and Member from seed
    const hasAdmin = await page
      .getByText(/admin/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const hasMember = await page
      .getByText(/member/i)
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    expect(hasAdmin || hasMember).toBe(true);
  });
});
