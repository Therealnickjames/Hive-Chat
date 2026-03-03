import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Log in via NextAuth API (bypasses form → more reliable in CI).
 * Uses page.evaluate to run fetch() in the browser context, ensuring
 * cookies are handled correctly by the browser's cookie jar.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Navigate to login page first to establish the page origin
  await page.goto("/login");

  // Run the login flow inside the browser context so cookies are
  // handled by the browser's native cookie jar (not Playwright's API client).
  const loginResult = await page.evaluate(
    async ({ email, password }) => {
      // 1. Get CSRF token
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      // 2. Sign in via credentials callback
      const signInRes = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken,
          email,
          password,
          json: "true",
        }),
        redirect: "follow",
      });

      return {
        status: signInRes.status,
        ok: signInRes.ok,
        url: signInRes.url,
      };
    },
    { email, password },
  );

  if (!loginResult.ok && loginResult.status !== 200) {
    throw new Error(
      `Login API failed for ${email}: status ${loginResult.status}`,
    );
  }

  // 3. Navigate to app — browser now has the session cookie
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "SERVERS" }),
  ).toBeVisible({ timeout: 15_000 });
}
