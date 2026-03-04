import { chromium } from "@playwright/test";

async function waitForCountIncrease(locator, baseline, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await locator.count();
    if (current > baseline) return current;
    await locator.page().waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for count increase from ${baseline}`);
}

async function run() {
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await page.waitForSelector("#email", { timeout: 10000 });
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
  if (!serverId) throw new Error("No server available for automation run");

  const channelsResp = await context.request.get(
    `${baseUrl}/api/servers/${serverId}/channels`
  );
  const channelsJson = await channelsResp.json();
  const dev = channelsJson.channels.find((c) => c.name === "dev");
  const general = channelsJson.channels.find((c) => c.name === "general");
  if (!dev) throw new Error("Expected #dev channel");
  if (!general) throw new Error("Expected #general channel");

  await page.goto(`${baseUrl}/servers/${serverId}/channels/${dev.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1000);

  const input = page.getByRole("textbox", { name: "Message #dev" });
  await input.fill("Automation cycle: plain message");
  await input.press("Enter");

  await page
    .getByText(/no bot triggered\..*mention @.+ to trigger it\./i)
    .waitFor({ timeout: 10000 });

  const apiKeyErrorLocator = page.getByText(/Bot API key is not configured/i);
  const inlineErrorHintLocator = page.getByText(/Bot response failed:/i);
  const baselineApiKeyErrors = await apiKeyErrorLocator.count();

  // Reproduce the scrolled-up case; UI should still follow new bot outcome.
  await page.evaluate(() => {
    const list = document.querySelector(".flex-1.overflow-y-auto.pb-4");
    if (list) list.scrollTop = 0;
  });
  await page.waitForTimeout(250);

  await input.fill("@GPT-4 automation cycle: mention message");
  await input.press("Enter");
  await waitForCountIncrease(apiKeyErrorLocator, baselineApiKeyErrors, 10000);
  await inlineErrorHintLocator.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);

  // Validate mixed-trigger channel behavior (#general):
  // - ALWAYS bot should trigger and produce visible error outcome
  // - mention-required hint should NOT appear when at least one bot triggers
  await page.goto(`${baseUrl}/servers/${serverId}/channels/${general.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1000);

  const generalInput = page.getByRole("textbox", { name: "Message #general" });
  const generalHint = page.getByText(/no bot triggered\..*mention @.+ to trigger it\./i);
  const generalHintBefore = await generalHint.count();
  const generalErrorBefore = await apiKeyErrorLocator.count();

  await generalInput.fill("Automation cycle: general plain message");
  await generalInput.press("Enter");
  await waitForCountIncrease(apiKeyErrorLocator, generalErrorBefore, 10000);
  await inlineErrorHintLocator.waitFor({ timeout: 10000 });

  const generalHintAfter = await generalHint.count();
  if (generalHintAfter > generalHintBefore) {
    throw new Error("Mention-required hint appeared in #general despite ALWAYS bot trigger");
  }

  await browser.close();
}

run().catch((error) => {
  console.error("automation-full-cycle failed:", error);
  process.exit(1);
});
