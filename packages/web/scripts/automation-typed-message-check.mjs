import { chromium } from "@playwright/test";

async function logDebug(message, data = {}) {
  if (process.env.AUTOMATION_DEBUG === "true") {
    console.debug("[automation-typed-message-check]", message, data);
  }
}

async function login(page, email, password) {
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:3001";
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
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
}

async function run() {
  const marker = Date.now();
  const toolName = `debug_tool_e9a21d_${marker}`;
  const baseUrl = process.env.AUTOMATION_BASE_URL || "http://localhost:3001";
  const shouldScrollUp = process.env.AUTOMATION_SCROLL_UP === "true";

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await login(page, "demo@tavok.ai", "DemoPass123!");

  const serversResp = await ctx.request.get(`${baseUrl}/api/servers`);
  const serversJson = await serversResp.json();
  const serverId = serversJson.servers?.[0]?.id;
  if (!serverId) throw new Error("No server available");

  const channelsResp = await ctx.request.get(
    `${baseUrl}/api/servers/${serverId}/channels`
  );
  const channelsJson = await channelsResp.json();
  const general = channelsJson.channels.find((c) => c.name === "general");
  if (!general) throw new Error("Expected #general channel");

  await page.goto(`${baseUrl}/servers/${serverId}/channels/${general.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("textbox").first().waitFor({ timeout: 10000 });

  if (shouldScrollUp) {
    const scrollMeta = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLDivElement>("div")
      ).filter((el) => {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const canScroll = overflowY === "auto" || overflowY === "scroll";
        const hasRows = Boolean(el.querySelector("[data-message-id]"));
        return canScroll && hasRows && el.scrollHeight > el.clientHeight;
      });
      const target = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!target) return { found: false };
      target.scrollTop = 0;
      return {
        found: true,
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
      };
    });
    await logDebug("Applied pre-webhook scroll up", {
      marker,
      shouldScrollUp,
      ...scrollMeta,
    });
    if (!scrollMeta.found) {
      const row = page.locator("[data-message-id]").last();
      await row.waitFor({ timeout: 10000 });
      const box = await row.boundingBox();
      if (box) {
        await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + Math.min(20, box.height / 2));
        await page.mouse.wheel(0, -5000);
        await page.mouse.wheel(0, -5000);
        await logDebug("Applied fallback wheel scroll up", {
          marker,
          shouldScrollUp,
          hadBoundingBox: true,
        });
      } else {
        await logDebug("Applied fallback wheel scroll up", {
          marker,
          shouldScrollUp,
          hadBoundingBox: false,
        });
      }
    }
  }

  const webhookResp = await ctx.request.post(
    `${baseUrl}/api/v1/webhooks/whk_e9a21d_typed_debug`,
    {
      data: {
        type: "TOOL_CALL",
        content: {
          callId: `call_${marker}`,
          toolName,
          arguments: { marker },
          status: "running",
        },
      },
    }
  );
  const webhookStatus = webhookResp.status();
  const webhookBody = await webhookResp.text();

  await logDebug("Typed webhook post completed", {
    marker,
    toolName,
    webhookStatus,
    webhookBodyLen: webhookBody.length,
  });

  if (webhookStatus >= 400) {
    throw new Error(`Typed webhook failed: ${webhookStatus} ${webhookBody}`);
  }

  const typedLocator = page.getByText(toolName).first();
  await typedLocator.waitFor({ timeout: 10000 });
  const isVisible = await typedLocator.isVisible();
  const metrics = await typedLocator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const inViewport =
      rect.bottom >= 0 &&
      rect.top <= (window.innerHeight || document.documentElement.clientHeight);
    return {
      top: rect.top,
      bottom: rect.bottom,
      inViewport,
    };
  });

  await logDebug("Typed message visible in UI", {
    marker,
    toolName,
    shouldScrollUp,
    isVisible,
    ...metrics,
  });
  if (!isVisible || !metrics.inViewport) {
    throw new Error(
      `Typed message not visibly in viewport (isVisible=${isVisible}, inViewport=${metrics.inViewport})`
    );
  }

  await browser.close();
}

run().catch((error) => {
  console.error("automation-typed-message-check failed:", error);
  process.exit(1);
});
