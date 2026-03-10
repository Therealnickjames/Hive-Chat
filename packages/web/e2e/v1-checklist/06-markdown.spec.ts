import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  uniqueMsg,
} from "./helpers";
import {
  ensureMockLLM,
  ensureMockAgent,
  cleanupMockLLM,
} from "./streaming-fixture";

test.describe("Section 6: Markdown Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");
  });

  test("bold text renders bold", async ({ page }) => {
    const ts = Date.now();
    const input = page.getByPlaceholder("Message #general");
    await input.fill(`**bold_${ts}**`);
    await input.press("Enter");

    await expect(
      page.locator("strong").filter({ hasText: `bold_${ts}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("italic text renders italic", async ({ page }) => {
    const ts = Date.now();
    const input = page.getByPlaceholder("Message #general");
    await input.fill(`*italic_${ts}*`);
    await input.press("Enter");

    await expect(
      page.locator("em").filter({ hasText: `italic_${ts}` }),
    ).toBeVisible({ timeout: 10_000 });
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
    await input.fill(`\`\`\`js\nconst x_${ts} = 42;\n\`\`\``);
    await input.press("Enter");

    await expect(
      page.locator("pre").filter({ hasText: `x_${ts}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("links are clickable", async ({ page }) => {
    const ts = Date.now();
    const input = page.getByPlaceholder("Message #general");
    await input.fill(`[link_${ts}](https://example.com/${ts})`);
    await input.press("Enter");

    const link = page.locator(`a[href="https://example.com/${ts}"]`);
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveText(`link_${ts}`);
  });
});

// -------------------------------------------------------------------------
// Markdown during streaming — requires mock LLM agent
// -------------------------------------------------------------------------
test.describe("Section 6: Markdown During Streaming", () => {
  test.beforeAll(async () => {
    await ensureMockLLM();
  });

  test.afterAll(async () => {
    await cleanupMockLLM();
  });

  test("streamed markdown renders bold, italic, code, and code block", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await ensureMockAgent(page);

    // Use #dev so only our ALWAYS-trigger mock agent fires
    await openChannel(page, "dev");
    await waitForWebSocket(page, "dev");

    // Send MARKDOWN_TEST trigger — mock LLM streams formatted markdown:
    //   "Here is **bold text** and *italic text* and `inline_code` in one response.
    //    ```js\nconst x = 42;\n```"
    const msg = uniqueMsg("MARKDOWN_TEST");
    const input = page.getByPlaceholder("Message #dev");
    await input.fill(msg);
    await input.press("Enter");

    // Wait for own message
    await expect(page.getByText(msg)).toBeVisible({ timeout: 10_000 });

    // Bold text should render as <strong>
    // Use .first() because previous test runs may have left messages in the channel
    await expect(
      page.locator("strong").filter({ hasText: "bold text" }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Italic text should render as <em>
    await expect(
      page.locator("em").filter({ hasText: "italic text" }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Inline code should render as <code>
    await expect(
      page.locator("code").filter({ hasText: "inline_code" }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Code block should render in <pre>
    await expect(
      page.locator("pre").filter({ hasText: "const x = 42" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
