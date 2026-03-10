import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import {
  registerUser,
  login,
  createServerViaUI,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
} from "./helpers";

// This test MUST run last — it wipes the database.
test.describe("Section 21: Final Sanity", () => {
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd().replace(/packages[/\\]web$/, "");

  test("full wipe and restart — fresh flow works from zero", async ({
    page,
  }) => {
    test.setTimeout(180_000); // 3 minutes for full cycle

    // Step 1: Full wipe
    execSync("docker compose down -v", {
      cwd: projectDir,
      timeout: 60_000,
      encoding: "utf-8",
    });

    // Step 2: Restart
    execSync("docker compose up -d", {
      cwd: projectDir,
      timeout: 60_000,
      encoding: "utf-8",
    });

    // Step 3: Wait for services to be healthy
    let healthy = false;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(10_000);
      try {
        const res = await page.request.get("http://localhost:5555/api/health");
        const data = await res.json();
        if (data.status === "ok") {
          healthy = true;
          break;
        }
      } catch {
        // Services not ready yet
      }
    }
    expect(healthy, "Services should be healthy after restart").toBe(true);

    // Step 4: Run migrations from host
    try {
      execSync(
        `DATABASE_URL="postgresql://tavok:${process.env.POSTGRES_PASSWORD || "tavok"}@localhost:55432/tavok" npx prisma migrate deploy`,
        {
          cwd: projectDir,
          timeout: 30_000,
          encoding: "utf-8",
        },
      );
    } catch {
      // Migrations may already be applied
    }

    // Step 5: Register a fresh user
    const ts = Date.now();
    const freshUser = {
      email: `fresh_${ts}@test.local`,
      username: `fresh_${ts}`,
      displayName: `Fresh User ${ts}`,
      password: "TestPass123!",
    };
    await registerUser(page, freshUser);

    await expect(page.getByRole("tab", { name: "SERVERS" })).toBeVisible({
      timeout: 15_000,
    });

    // Step 6: Create a server
    const serverName = `Fresh Server ${ts}`;
    await createServerViaUI(page, serverName);

    // Step 7: Send a message
    await page.getByRole("tab", { name: "SERVERS" }).click();
    await page.getByText(serverName).first().click();
    await page.waitForTimeout(500);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("Fresh-start");
    await sendMessage(page, "general", msg);

    // Step 8: Full flow works
    await expect(page.getByText(msg)).toBeVisible({ timeout: 10_000 });
  });

  test("nothing in UI says HiveChat", async ({ page }) => {
    // This test runs after the fresh start, or on the existing setup
    try {
      await page.goto("/login", { waitUntil: "domcontentloaded" });
    } catch {
      // If services are down from the wipe test, try to wait
      await page.waitForTimeout(5_000);
      await page.goto("/login", { waitUntil: "domcontentloaded" });
    }

    const pageContent = await page.content();
    expect(pageContent.toLowerCase()).not.toContain("hivechat");

    // Also check the main app page if logged in
    try {
      await login(page, "fresh_" + Date.now() + "@test.local", "TestPass123!");
    } catch {
      // May not be logged in — that's OK, just check what's visible
    }

    const bodyText = await page
      .locator("body")
      .textContent()
      .catch(() => "");
    expect(bodyText?.toLowerCase() || "").not.toContain("hivechat");
  });
});
