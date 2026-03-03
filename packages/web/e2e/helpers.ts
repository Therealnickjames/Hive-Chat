import type { Page, APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Log in via NextAuth API (bypasses form → more reliable in CI).
 * Sets the session cookie on the browser context so subsequent
 * navigations are authenticated.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const baseURL = "http://localhost:3000";
  const context = page.context();

  // 1. Get CSRF token
  const csrfRes = await context.request.get(`${baseURL}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();

  // 2. Sign in via credentials callback
  const signInRes = await context.request.post(
    `${baseURL}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken,
        email,
        password,
        json: "true",
      },
    },
  );

  // The response sets the session cookie on the context automatically.
  // Verify we got a session cookie.
  const cookies = await context.cookies(baseURL);
  const sessionCookie = cookies.find(
    (c) =>
      c.name === "next-auth.session-token" ||
      c.name === "__Secure-next-auth.session-token",
  );

  if (!sessionCookie) {
    throw new Error(
      `Login failed for ${email}: no session cookie set. Status: ${signInRes.status()}`,
    );
  }

  // 3. Navigate to app — should be authenticated now
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "SERVERS" }),
  ).toBeVisible({ timeout: 15_000 });
}
