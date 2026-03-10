import { test, expect } from "@playwright/test";
import { login, registerUser, DEMO_USER, ALICE, BOB } from "./helpers";

test.describe("Section 2: Auth & Accounts", () => {
  const ts = Date.now();
  const freshUser = {
    email: `e2e_${ts}@test.local`,
    username: `e2e_${ts}`,
    displayName: `E2E Tester ${ts}`,
    password: "TestPass123!",
  };

  test("register new account and land on dashboard", async ({ page }) => {
    await registerUser(page, freshUser);

    // Should land on dashboard — wait for SERVERS tab
    await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("log out successfully", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);

    // Open user profile dropdown
    const profileButton = page
      .locator('[data-testid="user-profile-button"]')
      .or(
        page
          .locator("button")
          .filter({ hasText: DEMO_USER.displayName })
          .first(),
      );

    // Click the user area at the bottom of the sidebar
    await profileButton
      .or(
        page
          .locator(".flex.items-center.gap-2")
          .filter({ hasText: /demo/i })
          .first(),
      )
      .click({ timeout: 5_000 })
      .catch(async () => {
        // Fallback: try clicking the avatar/user button at the bottom
        await page
          .locator("button")
          .filter({ hasText: /log out/i })
          .click();
      });

    // Click "Log Out"
    const logOutButton = page.getByText(/log out/i);
    if (await logOutButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await logOutButton.click();
    }

    // Should redirect to login page
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });

  test("log back in with same credentials", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("page refresh preserves session (JWT persists)", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
      timeout: 10_000,
    });

    // Refresh the page
    await page.reload({ waitUntil: "domcontentloaded" });

    // Should still be on the app (not redirected to login)
    await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).not.toContain("/login");
  });

  test("register second user in separate browser context", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const secondUser = {
        email: `e2e_second_${ts}@test.local`,
        username: `e2e_s_${ts}`,
        displayName: `Second User ${ts}`,
        password: "TestPass123!",
      };

      await registerUser(page, secondUser);

      await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await context.close();
    }
  });

  test("wrong password shows clear error (not crash)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_USER.email);
    await page.getByLabel("Password").fill("WrongPassword999!");
    await page.getByRole("button", { name: /log in/i }).click();

    // Should show an error message
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({
      timeout: 5_000,
    });

    // Should stay on login page (not crash)
    expect(page.url()).toContain("/login");
  });

  test("duplicate email shows clear error", async ({ page }) => {
    // Try to register with an email that already exists (demo@tavok.ai)
    await registerUser(page, {
      email: DEMO_USER.email,
      username: `dup_${ts}`,
      displayName: "Duplicate Test",
      password: "TestPass123!",
    });

    // Should show error about duplicate email
    await expect(page.getByText(/already|exists|taken|in use/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("duplicate username shows clear error", async ({ page }) => {
    await registerUser(page, {
      email: `unique_${ts}@test.local`,
      username: DEMO_USER.username, // "demouser" already exists
      displayName: "Dup Username",
      password: "TestPass123!",
    });

    await expect(page.getByText(/already|exists|taken|in use/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
