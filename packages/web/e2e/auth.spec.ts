import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

// ---------------------------------------------------------------------------
// Seed data — must match prisma/seed.mjs
// ---------------------------------------------------------------------------
const DEMO_USER = { email: "demo@tavok.ai", password: "DemoPass123!" };
const ALICE = { email: "alice@tavok.ai", password: "DemoPass123!" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill the login form and submit. Does NOT assert the result. */
async function fillLoginForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Authentication", () => {
  test("login page renders heading and form fields", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: /welcome back/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /log in/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /register/i })).toBeVisible();
  });

  test("login with valid credentials loads the app", async ({ page }) => {
    // Use API-based login (more reliable in Docker/CI than form redirect)
    await login(page, DEMO_USER.email, DEMO_USER.password);

    // The app layout has tab buttons in the left panel: SERVERS, CHANNELS, DMs
    await expect(page.getByRole("button", { name: "SERVERS" })).toBeVisible({ timeout: 10_000 });
  });

  test("login with alice account succeeds", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);

    await expect(page.getByRole("button", { name: "SERVERS" })).toBeVisible({ timeout: 10_000 });
  });

  test("invalid login shows error message", async ({ page }) => {
    await page.goto("/login");
    await fillLoginForm(page, "wrong@example.com", "BadPassword999!");

    // The error message should appear inside the form
    await expect(
      page.getByText(/invalid email or password/i),
    ).toBeVisible({ timeout: 5_000 });

    // Should stay on the login page
    expect(page.url()).toContain("/login");
  });

  test("empty form submission does not navigate away", async ({ page }) => {
    await page.goto("/login");
    // The email and password inputs have `required`, so the browser will
    // block submission. We click the button and assert we stay on login.
    await page.getByRole("button", { name: /log in/i }).click();

    // We should still be on the login page
    expect(page.url()).toContain("/login");
  });

  test("protected page redirects to login when unauthenticated", async ({
    page,
  }) => {
    // Navigate directly to an app page without being logged in
    await page.goto("/");

    // Middleware should redirect to /login
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });

  test("protected server page redirects to login", async ({ page }) => {
    // Try a deep link to a server/channel page
    await page.goto("/servers/some-fake-id/channels/another-fake-id");

    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });

  test("register link navigates to registration page", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /register/i }).click();

    await page.waitForURL(/\/register/, { timeout: 5_000 });
    expect(page.url()).toContain("/register");
  });
});
