import { test, expect } from "@playwright/test";
import {
  login,
  ALICE,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  createServerViaAPI,
  createInviteViaAPI,
  joinServerViaAPI,
} from "./helpers";

/**
 * TASK-0023: Server Settings E2E tests
 *
 * Tests the server settings overlay UI — opening/closing, tab navigation,
 * overview editing, channel creation, member list, invite creation,
 * and danger zone confirmation.
 */

let serverName: string;
let serverId: string;

test.beforeAll(async ({ browser }) => {
  serverName = `Settings-S23-${Date.now()}`;

  // Owner creates server + invite
  const ctxOwner = await browser.newContext();
  const pgOwner = await ctxOwner.newPage();
  await login(pgOwner, DEMO_USER.email, DEMO_USER.password);
  const result = await createServerViaAPI(pgOwner, serverName);
  serverId = result.serverId;
  const inviteCode = await createInviteViaAPI(pgOwner, serverId);
  await ctxOwner.close();

  // Alice joins as a regular member (no MANAGE_SERVER)
  const ctxA = await browser.newContext();
  const pgA = await ctxA.newPage();
  await login(pgA, ALICE.email, ALICE.password);
  await joinServerViaAPI(pgA, inviteCode);
  await ctxA.close();
});

test.describe("Section 23: Server Settings", () => {
  test("Settings gear icon is visible for server owner", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const settingsBtn = page.locator('[data-testid="server-settings-btn"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
  });

  test("Clicking gear opens settings overlay", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    const overlay = page.locator('[data-testid="server-settings-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3_000 });

    // Overview tab is the default
    await expect(
      page.locator('[data-testid="settings-tab-overview"]'),
    ).toBeVisible();
  });

  test("Close button closes overlay", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).not.toBeVisible({ timeout: 3_000 });
  });

  test("Tab navigation works", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    // Click Channels tab
    await page.locator('[data-testid="settings-tab-channels"]').click();
    await expect(
      page.locator('[data-testid="settings-create-channel-btn"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Click Members tab
    await page.locator('[data-testid="settings-tab-members"]').click();
    // Should show member count
    await expect(page.getByText(/member/i)).toBeVisible({ timeout: 5_000 });

    // Click Invites tab
    await page.locator('[data-testid="settings-tab-invites"]').click();
    await expect(
      page.locator('[data-testid="settings-create-invite-btn"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Click Danger Zone tab
    await page.locator('[data-testid="settings-tab-danger"]').click();
    await expect(
      page.locator('[data-testid="settings-delete-confirm-input"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Overview tab — server name is editable", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    // Server name input should contain the current server name
    const nameInput = page.locator(
      '[data-testid="settings-server-name-input"]',
    );
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toHaveValue(serverName, { timeout: 5_000 });
  });

  test("Channels tab — create channel shows in list", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="settings-tab-channels"]').click();
    await expect(
      page.locator('[data-testid="settings-create-channel-btn"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Create a new channel
    const channelName = `test-ch-${Date.now()}`;
    await page.locator('[data-testid="settings-create-channel-btn"]').click();
    await page.getByPlaceholder("channel-name").fill(channelName);
    await page.getByRole("button", { name: "Create" }).click();

    // Channel should appear in the list
    await expect(page.getByText(channelName)).toBeVisible({ timeout: 10_000 });
  });

  test("Members tab — shows all server members", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="settings-tab-members"]').click();

    // Should show both Demo User and Alice
    await expect(page.getByText(DEMO_USER.displayName)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(ALICE.displayName)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Invites tab — create invite shows in list", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="settings-tab-invites"]').click();
    await expect(
      page.locator('[data-testid="settings-create-invite-btn"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Create a new invite
    await page.locator('[data-testid="settings-create-invite-btn"]').click();

    // Wait for invite code to appear (8-char code)
    await expect(page.locator(".font-mono").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Danger Zone — delete button disabled until server name typed", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    await page.locator('[data-testid="server-settings-btn"]').click();
    await expect(
      page.locator('[data-testid="server-settings-overlay"]'),
    ).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="settings-tab-danger"]').click();

    const deleteInput = page.locator(
      '[data-testid="settings-delete-confirm-input"]',
    );
    const deleteBtn = page.locator(
      '[data-testid="settings-delete-server-btn"]',
    );

    await expect(deleteInput).toBeVisible({ timeout: 5_000 });
    await expect(deleteBtn).toBeDisabled();

    // Type wrong text — still disabled
    await deleteInput.fill("wrong text");
    await expect(deleteBtn).toBeDisabled();

    // Type correct server name — enabled
    await deleteInput.fill(serverName);
    await expect(deleteBtn).toBeEnabled();
  });

  test("Settings gear hidden for non-MANAGE_SERVER user", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Alice has no MANAGE_SERVER permission, gear should not be visible
    const settingsBtn = page.locator('[data-testid="server-settings-btn"]');
    await expect(settingsBtn).not.toBeVisible({ timeout: 3_000 });
  });
});
