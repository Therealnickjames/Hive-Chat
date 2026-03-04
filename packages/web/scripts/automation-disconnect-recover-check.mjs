import { chromium } from "@playwright/test";

function logDebug(message, data = {}) {
  if (process.env.AUTOMATION_DEBUG === "true") {
    console.debug("[automation-disconnect-recover-check]", message, data);
  }
}

async function run() {
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await page.fill("#email", "demo@tavok.ai");
    await page.fill("#password", "DemoPass123!");
    await Promise.allSettled([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/auth/callback/credentials"),
        { timeout: 15000 }
      ),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 12000,
    });
  }

  const serversResp = await context.request.get(`${baseUrl}/api/servers`);
  const serversJson = await serversResp.json();
  const serverId = serversJson.servers?.[0]?.id;
  if (!serverId) throw new Error("No server available");

  const channelsResp = await context.request.get(
    `${baseUrl}/api/servers/${serverId}/channels`
  );
  const channelsJson = await channelsResp.json();
  const firstChannel = channelsJson.channels?.[0];
  if (!firstChannel) throw new Error("No channel available");

  await page.goto(`${baseUrl}/servers/${serverId}/channels/${firstChannel.id}`, {
    waitUntil: "domcontentloaded",
  });

  const input = page.getByRole("textbox").first();
  await input.waitFor({ timeout: 10000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector("textarea, input[type='text']");
      return Boolean(el) && !(el).disabled;
    },
    { timeout: 10000 }
  );

  const disconnectedBanner = page.getByText(/DISCONNECTED FROM CHANNEL GATEWAY/i);
  let sawDisconnected = false;

  const started = Date.now();
  while (Date.now() - started < 14000) {
    const count = await disconnectedBanner.count();
    if (count > 0) sawDisconnected = true;
    await page.waitForTimeout(400);
  }

  const finalDisconnectedCount = await disconnectedBanner.count();
  const finalConnectingCount = await page
    .getByText(/CONNECTING TO CHANNEL GATEWAY/i)
    .count();
  const inputDisabledAtEnd = await input.isDisabled();

  logDebug("Disconnect-recover scenario evaluated", {
    serverId,
    channelId: firstChannel.id,
    sawDisconnected,
    finalDisconnectedCount,
    finalConnectingCount,
    inputDisabledAtEnd,
  });

  await browser.close();
}

run().catch((error) => {
  console.error("automation-disconnect-recover-check failed:", error);
  process.exit(1);
});

