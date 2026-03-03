import { chromium } from "@playwright/test";

function logDebug(message, data = {}) {
  // #region agent log
  fetch("http://127.0.0.1:7856/ingest/0c40b409-8f04-4dd8-a742-cb291a1de852", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "e9a21d",
    },
    body: JSON.stringify({
      sessionId: "e9a21d",
      runId: "multi-actor",
      hypothesisId: "H20",
      location: "automation-multi-actor.mjs",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

async function login(page, email, password, label) {
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await page.waitForSelector("#email", { timeout: 10000 });
    await page.fill("#email", email);
    await page.fill("#password", password);
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
  logDebug("Actor login complete", { actor: label, email });
}

async function run() {
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:3000";
  const preferHeaded = process.env.AUTOMATION_HEADLESS !== "true";

  let browser;
  try {
    browser = await chromium.launch({
      headless: !preferHeaded,
      slowMo: preferHeaded ? 75 : 0,
    });
  } catch (error) {
    if (!preferHeaded) throw error;
    logDebug("Headed launch failed; falling back to headless", {
      error: String(error),
    });
    browser = await chromium.launch({ headless: true });
  }

  const demoCtx = await browser.newContext();
  const aliceCtx = await browser.newContext();

  const demoPage = await demoCtx.newPage();
  const alicePage = await aliceCtx.newPage();

  await Promise.all([
    login(demoPage, "demo@tavok.ai", "DemoPass123!", "demo"),
    login(alicePage, "alice@tavok.ai", "DemoPass123!", "alice"),
  ]);

  const serversResp = await demoCtx.request.get(`${baseUrl}/api/servers`);
  const serversJson = await serversResp.json();
  const serverId = serversJson.servers?.[0]?.id;
  if (!serverId) throw new Error("No server available");

  const channelsResp = await demoCtx.request.get(
    `${baseUrl}/api/servers/${serverId}/channels`
  );
  const channelsJson = await channelsResp.json();
  const general = channelsJson.channels.find((c) => c.name === "general");
  if (!general) throw new Error("Expected #general channel");

  await Promise.all([
    demoPage.goto(`${baseUrl}/servers/${serverId}/channels/${general.id}`, {
      waitUntil: "domcontentloaded",
    }),
    alicePage.goto(`${baseUrl}/servers/${serverId}/channels/${general.id}`, {
      waitUntil: "domcontentloaded",
    }),
  ]);

  const marker = Date.now();
  const demoMessage = `demo -> alice multi-user ${marker}`;
  const aliceMessage = `alice -> demo multi-user ${marker}`;
  const mentionMessage = `@GPT-4 multi-actor mention ${marker}`;

  const demoInput = demoPage.getByRole("textbox").first();
  const aliceInput = alicePage.getByRole("textbox").first();

  await demoInput.fill(demoMessage);
  await demoInput.press("Enter");
  await alicePage.getByText(demoMessage).waitFor({ timeout: 10000 });
  logDebug("Alice observed demo message", { marker, phase: "human_to_human_1" });

  await aliceInput.fill(aliceMessage);
  await aliceInput.press("Enter");
  await demoPage.getByText(aliceMessage).waitFor({ timeout: 10000 });
  logDebug("Demo observed alice message", { marker, phase: "human_to_human_2" });

  const demoErrors = demoPage.getByText(/Bot API key is not configured/i);
  const aliceErrors = alicePage.getByText(/Bot API key is not configured/i);
  const demoErrorBefore = await demoErrors.count();
  const aliceErrorBefore = await aliceErrors.count();

  await aliceInput.fill(mentionMessage);
  await aliceInput.press("Enter");

  const started = Date.now();
  while (Date.now() - started < 12000) {
    const d = await demoErrors.count();
    const a = await aliceErrors.count();
    if (d > demoErrorBefore || a > aliceErrorBefore) break;
    await demoPage.waitForTimeout(250);
  }

  const demoErrorAfter = await demoErrors.count();
  const aliceErrorAfter = await aliceErrors.count();
  const inlineHintCount = await demoPage.getByText(/Bot response failed:/i).count();

  logDebug("Agent-to-human cycle observed", {
    marker,
    demoErrorBefore,
    demoErrorAfter,
    aliceErrorBefore,
    aliceErrorAfter,
    demoInlineHintCount: inlineHintCount,
    agentOutcomeVisible: demoErrorAfter > demoErrorBefore || aliceErrorAfter > aliceErrorBefore,
  });

  await browser.close();
}

run().catch((error) => {
  console.error("automation-multi-actor failed:", error);
  process.exit(1);
});
