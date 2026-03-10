import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  uniqueMsg,
} from "./helpers";

test.describe("Section 6: Markdown Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");
  });

  test("bold text renders bold", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.fill("**bold text here**");
    await input.press("Enter");

    await expect(
      page.locator("strong").filter({ hasText: "bold text here" }),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("italic text renders italic", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.fill("*italic text here*");
    await input.press("Enter");

    await expect(
      page.locator("em").filter({ hasText: "italic text here" }),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("inline code renders with code styling", async ({ page }) => {
    const ts = Date.now();
    const input = page.getByPlaceholder("Message #general");
    await input.fill(`check this \`code_${ts}\` out`);
    await input.press("Enter");

    await expect(
      page.locator("code").filter({ hasText: `code_${ts}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("code block renders with highlighting", async ({ page }) => {
    const ts = Date.now();
    const input = page.getByPlaceholder("Message #general");
    // Use Shift+Enter for newlines in the textarea
    await input.fill(`\`\`\`js\nconst x_${ts} = 42;\n\`\`\``);
    await input.press("Enter");

    // Should render in a <pre> block
    await expect(
      page.locator("pre").filter({ hasText: `x_${ts}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("links are clickable", async ({ page }) => {
    const input = page.getByPlaceholder("Message #general");
    await input.fill("[test link](https://example.com)");
    await input.press("Enter");

    const link = page.locator('a[href="https://example.com"]');
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveText("test link");
  });

  test.skip("markdown renders during streaming (requires live agent)", () => {
    // SKIPPED: Requires an active LLM agent connection to test streaming markdown.
    // Streaming markdown rendering is validated in Section 15 with the mock agent.
  });
});
