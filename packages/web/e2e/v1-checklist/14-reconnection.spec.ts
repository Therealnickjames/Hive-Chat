import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  ALICE,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
  createTwoUserContexts,
  cleanupContexts,
  createServerViaAPI,
  createInviteViaAPI,
  joinServerViaAPI,
} from "./helpers";

let serverName: string;
let serverId: string;

test.beforeAll(async ({ browser }) => {
  serverName = `Test-S14-${Date.now()}`;

  // Owner creates server + invite
  const ctxOwner = await browser.newContext();
  const pgOwner = await ctxOwner.newPage();
  await login(pgOwner, DEMO_USER.email, DEMO_USER.password);
  const result = await createServerViaAPI(pgOwner, serverName);
  serverId = result.serverId;
  const inviteCode = await createInviteViaAPI(pgOwner, serverId);
  await ctxOwner.close();

  // Alice joins
  const ctxA = await browser.newContext();
  const pgA = await ctxA.newPage();
  await login(pgA, ALICE.email, ALICE.password);
  await joinServerViaAPI(pgA, inviteCode);
  await ctxA.close();
});

test.describe("Section 14: Reconnection & Resilience", () => {
  test("refresh page mid-conversation — reconnects and loads history", async ({
    page,
  }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Send a message before refresh
    const msg = uniqueMsg("Pre-refresh");
    await sendMessage(page, "general", msg);

    // Refresh the page
    await page.reload({ waitUntil: "domcontentloaded" });

    // Re-navigate to the same channel
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Previous message should be loaded from history
    await expect(page.getByText(msg)).toBeVisible({ timeout: 10_000 });
  });

  test("send message after page refresh — message appears", async ({
    page,
  }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Refresh — wait for full load + React hydration + WebSocket init
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500); // Let React hydrate + WS connect start
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Send new message after reconnection
    const msg = uniqueMsg("Post-refresh");
    await sendMessage(page, "general", msg);

    // Message should appear
    await expect(page.getByText(msg)).toBeVisible({ timeout: 15_000 });
  });

  test("two users — Bob reloads, Alice sends, Bob sees new message", async ({
    browser,
  }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      DEMO_USER,
      ALICE,
    );

    try {
      await selectServer(pageA, serverName);
      await selectServer(pageB, serverName);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      // Bob (pageB) reloads — simulates reconnection
      await pageB.reload({ waitUntil: "domcontentloaded" });
      await selectServer(pageB, serverName);
      await openChannel(pageB, "general");
      await waitForWebSocket(pageB, "general");

      // Alice sends a message AFTER Bob's reload
      const msg = uniqueMsg("Reconnect-proof");
      await sendMessage(pageA, "general", msg);

      // Bob should see it via live WebSocket (not just history)
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  // Container-level resilience is tested by the regression harness (K-series tests)
});
