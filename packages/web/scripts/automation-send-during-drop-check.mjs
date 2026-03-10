import { chromium } from "@playwright/test";

function logDebug(message, data = {}) {
  if (process.env.AUTOMATION_DEBUG === "true") {
    console.debug("[automation-send-during-drop-check]", message, data);
  }
}

async function run() {
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:5555";
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

  const marker = Date.now();
  let attempted = 0;
  for (let i = 0; i < 8; i += 1) {
    if (await input.isDisabled()) break;
    attempted += 1;
    await input.fill(`drop-send probe ${marker} #${i + 1}`);
    await input.press("Enter");
    await page.waitForTimeout(350);
  }

  await page.waitForTimeout(2500);

  const disconnectedBannerVisibleCount = await page
    .getByText(/DISCONNECTED FROM CHANNEL GATEWAY/i)
    .count();
  const inputDisabledAtEnd = await input.isDisabled();
  const inlineHintCount = await page
    .getByText(/Agent response failed:|Disconnected from channel gateway/i)
    .count();
  const visibleSentMessageCount = await page
    .getByText(new RegExp(`drop-send probe ${marker}`))
    .count();

  logDebug("Send during drop scenario evaluated", {
    serverId,
    channelId: firstChannel.id,
    marker,
    attempted,
    visibleSentMessageCount,
    disconnectedBannerVisibleCount,
    inputDisabledAtEnd,
    inlineHintCount,
  });

  await browser.close();
}

run().catch((error) => {
  console.error("automation-send-during-drop-check failed:", error);
  process.exit(1);
});

