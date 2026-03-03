import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Log in via the credentials form.
 *
 * In Docker/CI the signIn() redirect may not fire because the
 * window.location.assign navigation never completes (page load
 * blocks on WebSocket/SSR in production mode). This helper detects
 * that case and navigates manually after verifying no error appeared.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  // Give signIn() time to complete the API call
  await page.waitForTimeout(3000);

  // Check current state
  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    // Check for error message — if present, login actually failed
    const errorVisible = await page
      .getByText(/invalid email or password/i)
      .isVisible()
      .catch(() => false);

    if (errorVisible) {
      throw new Error(`Login failed for ${email}: invalid credentials`);
    }

    // No error visible = signIn succeeded but redirect didn't fire.
    // Navigate directly — the session cookie should already be set
    // by the signIn API response.
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }

  // If we got redirected back to /login, the cookie wasn't set
  if (page.url().includes("/login")) {
    throw new Error(
      `Login failed for ${email}: session cookie not persisted (redirected back to /login)`,
    );
  }

  // Wait for the app layout to render
  await expect(
    page.getByRole("button", { name: "SERVERS" }),
  ).toBeVisible({ timeout: 15_000 });
}
