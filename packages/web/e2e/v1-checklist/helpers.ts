import type { Page, BrowserContext, Browser } from "@playwright/test";
import { expect } from "@playwright/test";
import { login } from "../helpers";

// Re-export login from parent helpers
export { login };

// ---------------------------------------------------------------------------
// Seed data — must match prisma/seed.mjs
// ---------------------------------------------------------------------------
export const DEMO_USER = {
  email: "demo@tavok.ai",
  password: "DemoPass123!",
  username: "demouser",
  displayName: "Demo User",
};
export const ALICE = {
  email: "alice@tavok.ai",
  password: "DemoPass123!",
  username: "alice",
  displayName: "Alice Chen",
};
export const BOB = {
  email: "bob@tavok.ai",
  password: "DemoPass123!",
  username: "bob",
  displayName: "Bob Martinez",
};

export const SEED_SERVER = "AI Research Lab";
export const SEED_CHANNELS = ["general", "research", "dev"];

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Select a server by name from the SERVERS tab in the sidebar. */
export async function selectServer(
  page: Page,
  serverName: string = SEED_SERVER,
): Promise<void> {
  await page.getByRole("tab", { name: "SERVERS" }).click();
  await page.getByText(serverName).first().click();
  await page.waitForTimeout(500);
}

/** Open a channel by name from the CHANNELS tab in the sidebar. */
export async function openChannel(
  page: Page,
  channelName: string,
): Promise<void> {
  await page.getByRole("tab", { name: "CHANNELS" }).click();
  const channelButton = page.locator("button").filter({
    has: page.locator(`text="${channelName}"`),
  });
  await channelButton.first().click();
  await expect(page.getByPlaceholder(`Message #${channelName}`)).toBeVisible({
    timeout: 10_000,
  });
}

/** Wait for WebSocket connection to be established (input becomes enabled). */
export async function waitForWebSocket(
  page: Page,
  channelName: string,
): Promise<void> {
  const input = page.getByPlaceholder(`Message #${channelName}`);
  await expect(input).toBeEnabled({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

/** Send a message in the currently open channel and wait for it to appear. */
export async function sendMessage(
  page: Page,
  channelName: string,
  text: string,
): Promise<void> {
  const input = page.getByPlaceholder(`Message #${channelName}`);
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });
}

/** Generate a unique message string with timestamp. */
export function uniqueMsg(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// UI interaction helpers
// ---------------------------------------------------------------------------

/** Register a new user via the registration form. */
export async function registerUser(
  page: Page,
  opts: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(opts.email);
  await page.getByLabel("Display Name").fill(opts.displayName);
  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Password", { exact: true }).fill(opts.password);
  await page.getByLabel("Confirm Password").fill(opts.password);
  await page.getByRole("button", { name: /continue/i }).click();
}

/**
 * Create a server via the UI modal.
 * Assumes the user is logged in and on the main app page.
 */
export async function createServerViaUI(
  page: Page,
  serverName: string,
): Promise<void> {
  // Click "New Server" button in the servers tab
  await page.getByRole("tab", { name: "SERVERS" }).click();
  await page.getByRole("button", { name: /new server/i }).click();

  // Step 1: Enter name
  await page.getByPlaceholder("My Awesome Server").fill(serverName);
  await page.getByRole("button", { name: "Configure" }).click();

  // Step 2: Keep defaults, submit
  await page.getByRole("button", { name: "Create Server" }).click();

  // Wait for navigation to the new server
  await page.waitForTimeout(2000);
}

/**
 * Create a channel via the UI modal.
 * Assumes a server is currently selected.
 */
export async function createChannelViaUI(
  page: Page,
  channelName: string,
): Promise<void> {
  // Click the "+" button (title="Create Channel") in the channels tab
  await page.locator('button[title="Create Channel"]').click();

  // Step 1: Enter name
  await page.getByPlaceholder("new-channel").fill(channelName);
  await page.getByRole("button", { name: "Configure" }).click();

  // Step 2: Keep defaults, submit (use form submit button to avoid conflict with title="Create Channel" icon)
  await page
    .locator('form button[type="submit"]')
    .filter({ hasText: "Create Channel" })
    .click();

  // Wait for navigation
  await page.waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// Multi-user context helpers
// ---------------------------------------------------------------------------

/** Create two browser contexts with logged-in users. */
export async function createTwoUserContexts(
  browser: Browser,
  userA: { email: string; password: string },
  userB: { email: string; password: string },
): Promise<{
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Page;
  pageB: Page;
}> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await login(pageA, userA.email, userA.password);
  await login(pageB, userB.email, userB.password);

  return { contextA, contextB, pageA, pageB };
}

/** Cleanup two browser contexts. */
export async function cleanupContexts(
  contextA: BrowserContext,
  contextB: BrowserContext,
): Promise<void> {
  await contextA.close();
  await contextB.close();
}
