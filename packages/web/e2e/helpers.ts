import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Log in using Playwright's API request context, which shares cookies
 * with the browser context.
 *
 * This bypasses the client-side `signIn()` from next-auth/react entirely,
 * replicating the same HTTP calls that the regression harness uses
 * (GET /api/auth/csrf → POST /api/auth/callback/credentials).
 *
 * Falls back to form-based login if the API approach fails.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // ── Strategy 1: API-based auth via page.request ───────────────────
  // page.request shares the cookie jar with the browser context,
  // so the session cookie set here will be sent by the browser.
  try {
    // Step 1: Get CSRF token (also sets the CSRF cookie)
    const csrfRes = await page.request.get("/api/auth/csrf");
    const csrfData = await csrfRes.json();
    const csrfToken: string = csrfData.csrfToken;

    if (!csrfToken) {
      throw new Error("No CSRF token returned from /api/auth/csrf");
    }

    // Step 2: Authenticate via NextAuth callback
    const authRes = await page.request.post("/api/auth/callback/credentials", {
      form: {
        email,
        password,
        csrfToken,
        json: "true",
      },
    });

    // NextAuth returns { url: "..." } with json:true.
    // If the URL contains "error", auth failed.
    const authData = await authRes.json().catch(() => null);

    if (authData?.url?.includes("error")) {
      throw new Error(`API auth returned error URL: ${authData.url}`);
    }

    // Step 3: Wait for cookie jar to sync before navigating.
    // NextAuth writes the session cookie asynchronously — without this
    // the browser may navigate before the cookie is in the jar.
    await page.waitForTimeout(300);

    // Verify session cookie exists in the jar before navigating
    const cookies = await page.context().cookies();
    const hasSession = cookies.some(
      (c) =>
        c.name.includes("next-auth.session-token") ||
        c.name.includes("__Secure-next-auth.session-token"),
    );
    if (!hasSession) {
      // Cookie not yet in jar — wait longer and retry
      await page.waitForTimeout(1_000);
    }

    // Step 4: Navigate to the app (session cookie is in the shared jar)
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // If we landed on /login, the session cookie wasn't accepted
    if (!page.url().includes("/login")) {
      // Success — wait for app to render
      await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
        timeout: 15_000,
      });
      return;
    }

    // Fall through to Strategy 2
    console.log(
      `[login] API auth set cookie but redirected to /login for ${email}, trying form login`,
    );
  } catch (apiError) {
    console.log(
      `[login] API auth failed for ${email}: ${apiError}, trying form login`,
    );
  }

  // ── Strategy 2: Form-based login ──────────────────────────────────
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  // Give signIn() time to complete
  await page.waitForTimeout(3000);

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

    // No error = signIn succeeded but redirect didn't fire.
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }

  if (page.url().includes("/login")) {
    // Retry once — NextAuth occasionally doesn't persist the session cookie
    // on the first attempt in CI (race condition with cookie jar).
    console.log(
      `[login] First form attempt redirected to /login for ${email}, retrying...`,
    );
    await page.waitForTimeout(1_000);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForTimeout(3_000);

    if (page.url().includes("/login")) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
    }

    if (page.url().includes("/login")) {
      throw new Error(
        `Login failed for ${email}: session cookie not persisted (redirected back to /login)`,
      );
    }
  }

  await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
    timeout: 15_000,
  });
}
