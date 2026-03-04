import { chromium } from "@playwright/test";

function logDebug(message, data = {}) {
  if (process.env.AUTOMATION_DEBUG === "true") {
    console.debug("[automation-disconnect-send-check]", message, data);
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
  await page.waitForTimeout(1200);

  const disconnectedBanner = page.getByText(/DISCONNECTED FROM CHANNEL GATEWAY/i);
  const connectingBanner = page.getByText(/CONNECTING TO CHANNEL GATEWAY/i);
  const disconnectedBannerVisibleCount = await disconnectedBanner.count();
  const connectingBannerVisibleCount = await connectingBanner.count();

  const input = page.getByRole("textbox").first();
  const inputDisabled = await input.isDisabled();

  if (!inputDisabled) {
    await input.fill("automation: disconnected send check");
    await input.press("Enter");
    await page.waitForTimeout(500);
  }

  logDebug("Disconnected send scenario executed", {
    serverId,
    channelId: firstChannel.id,
    disconnectedBannerVisibleCount,
    connectingBannerVisibleCount,
    inputDisabled,
  });

  await browser.close();
}

run().catch((error) => {
  console.error("automation-disconnect-send-check failed:", error);
  process.exit(1);
});
