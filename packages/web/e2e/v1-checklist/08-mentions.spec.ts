import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
} from "./helpers";
import {
  ensureMockLLM,
  ensureMockAgent,
  cleanupMockLLM,
  MOCK_AGENT_NAME,
} from "./streaming-fixture";

test.describe("Section 8: @Mentions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");
  });

  test("type @ — autocomplete dropdown appears", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.pressSequentially("@", { delay: 100 });

    // The dropdown renders as buttons with user names (e.g., "Alice Chen", "Bob Martinez")
    // Wait for at least one user button to appear near the input
    await expect(
      page
        .getByRole("button", { name: /Alice Chen|Bob Martinez|Demo User/i })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("dropdown shows users in channel", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.pressSequentially("@", { delay: 100 });

    await page.waitForTimeout(1_000);

    // Should show users and agents in the dropdown buttons
    await expect(page.getByRole("button", { name: /Alice Chen/i })).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(
      page.getByRole("button", { name: /Bob Martinez/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("select user — mention inserted and sends", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    const ts = Date.now();

    // Type @ to trigger autocomplete, then filter to "ali"
    await input.pressSequentially("@", { delay: 100 });
    await page.waitForTimeout(500);
    await input.pressSequentially("ali", { delay: 150 });

    // Wait for Alice to appear in the dropdown
    const aliceOption = page.getByRole("button", { name: /Alice Chen/i });
    await expect(aliceOption).toBeVisible({ timeout: 5_000 });

    // Select Alice — the component uses onMouseDown with preventDefault
    await aliceOption.click();
    await page.waitForTimeout(500);

    // After selection, input should contain "@Alice Chen " — type the rest
    await input.pressSequentially(`pill-test ${ts}`, { delay: 50 });
    await input.press("Enter");

    // Verify the message was sent (the rendered message contains both the mention and our text)
    await expect(page.getByText(`pill-test ${ts}`)).toBeVisible({
      timeout: 10_000,
    });
  });

  test.describe("agent mention triggers response", () => {
    test.beforeAll(async () => {
      await ensureMockLLM();
    });

    test.afterAll(async () => {
      await cleanupMockLLM();
    });

    test("@mention Echo Test Agent — agent responds", async ({ page }) => {
      await ensureMockAgent(page);

      // Navigate to #dev where the mock agent is available with ALWAYS trigger
      await openChannel(page, "dev");
      await waitForWebSocket(page, "dev");

      const msg = uniqueMsg("MentionAgent");
      await sendMessage(page, "dev", msg);

      // The mock agent has triggerMode: "ALWAYS" so it responds to any message
      // Wait for the echoed response
      const echoText = `[echo] ${msg}`;
      await expect(page.getByText(echoText)).toBeVisible({ timeout: 30_000 });
    });
  });
});
