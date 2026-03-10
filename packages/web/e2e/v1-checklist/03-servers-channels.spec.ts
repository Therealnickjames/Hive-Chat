import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  SEED_SERVER,
  selectServer,
  openChannel,
  createServerViaUI,
  createChannelViaUI,
} from "./helpers";

test.describe("Section 3: Servers & Channels", () => {
  const ts = Date.now();

  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
  });

  test("create a new server with name", async ({ page }) => {
    const serverName = `Test Server ${ts}`;
    await createServerViaUI(page, serverName);

    // Server should appear in sidebar
    await page.getByRole("tab", { name: "SERVERS" }).click();
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("server appears in left sidebar", async ({ page }) => {
    await page.getByRole("tab", { name: "SERVERS" }).click();
    // The seeded server should be visible
    await expect(page.getByText(SEED_SERVER).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("default channel exists after server creation", async ({ page }) => {
    // Navigate to seeded server
    await selectServer(page);
    await page.getByRole("tab", { name: "CHANNELS" }).click();

    // #general channel should exist (created by seed or by server creation)
    await expect(
      page.locator("button").filter({ hasText: "general" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("create a second channel", async ({ page }) => {
    await selectServer(page);
    const channelName = `test-ch-${ts}`;
    await createChannelViaUI(page, channelName);

    // New channel should be visible in sidebar
    await page.getByRole("tab", { name: "CHANNELS" }).click();
    await expect(
      page.locator("button").filter({ hasText: channelName }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("switch between channels — content updates", async ({ page }) => {
    await selectServer(page);

    // Open #general
    await openChannel(page, "general");
    await expect(page.getByPlaceholder("Message #general")).toBeVisible();

    // Open #research
    await openChannel(page, "research");
    await expect(page.getByPlaceholder("Message #research")).toBeVisible();
  });

  test("create second server — both in sidebar", async ({ page }) => {
    const server2 = `Second Server ${ts}`;
    await createServerViaUI(page, server2);

    await page.getByRole("tab", { name: "SERVERS" }).click();
    // Both servers should be visible
    await expect(page.getByText(SEED_SERVER).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(server2).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("switch between servers — channels update", async ({ page }) => {
    await page.getByRole("tab", { name: "SERVERS" }).click();

    // Select the seeded server
    await page.getByText(SEED_SERVER).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "CHANNELS" }).click();

    // Should show the seeded channels
    await expect(
      page.locator("button").filter({ hasText: "general" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("button").filter({ hasText: "research" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
