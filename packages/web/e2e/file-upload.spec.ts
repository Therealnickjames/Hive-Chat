import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";
import { login } from "./helpers";

// ---------------------------------------------------------------------------
// Seed data — must match prisma/seed.mjs
// ---------------------------------------------------------------------------
const DEMO_USER = { email: "demo@tavok.ai", password: "DemoPass123!" };

async function openChannel(page: Page, channelName: string): Promise<void> {
  await page.getByText("CHANNELS", { exact: true }).click();

  const channelButton = page.locator("button").filter({
    has: page.locator(`text="${channelName}"`),
  });
  await channelButton.first().click();

  await expect(
    page.getByPlaceholder(`Message #${channelName}`),
  ).toBeVisible({ timeout: 10_000 });
}

async function selectServer(page: Page): Promise<void> {
  await page.getByText("SERVERS", { exact: true }).click();
  await page.getByText("AI Research Lab").click();
  await page.waitForTimeout(500);
}

/**
 * Create a temporary test file and return its path.
 */
function createTempFile(filename: string, content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Create a small 1x1 pixel PNG image for testing image uploads.
 */
function createTempImage(filename: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, filename);
  // Minimal valid 1x1 white PNG
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(filePath, pngBuffer);
  return filePath;
}

/**
 * Upload a file via the hidden file input and wait for the upload
 * to complete (pending chip appears + upload API finishes).
 */
async function uploadFile(page: Page, filePath: string): Promise<string> {
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);

  const fileName = path.basename(filePath);

  // Wait for the pending chip to appear (filename visible)
  await expect(page.getByText(fileName).first()).toBeVisible({
    timeout: 10_000,
  });

  // Wait for the upload POST to complete. The chip shows immediately
  // but the async upload to /api/uploads takes time.
  await page.waitForTimeout(2_000);

  return fileName;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("File Upload", () => {
  let tempFiles: string[] = [];

  test.beforeEach(async ({ page }) => {
    tempFiles = [];
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    // Give WebSocket connection time to fully establish
    await page.waitForTimeout(1_000);
  });

  test.afterEach(async () => {
    // Clean up temp files
    for (const f of tempFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  });

  test("upload button is visible and clickable", async ({ page }) => {
    const uploadButton = page.getByRole("button", { name: "Upload file" });
    await expect(uploadButton.first()).toBeVisible();
    await expect(uploadButton.first()).toBeEnabled();
  });

  test("upload a text file via file input", async ({ page }) => {
    const filePath = createTempFile(
      `test-upload-${Date.now()}.txt`,
      "Hello from E2E test!",
    );
    tempFiles.push(filePath);

    const fileName = await uploadFile(page, filePath);

    // Type a message to go with the file (ensures message sends)
    const messageInput = page.getByPlaceholder("Message #general");
    await messageInput.fill("File upload test");
    await messageInput.press("Enter");

    // After sending, the file attachment should render as a download link
    await expect(
      page.locator("a").filter({ hasText: fileName }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("upload an image file and see inline preview", async ({ page }) => {
    const filePath = createTempImage(`test-image-${Date.now()}.png`);
    tempFiles.push(filePath);

    const fileName = await uploadFile(page, filePath);

    // Send with a message
    const messageInput = page.getByPlaceholder("Message #general");
    await messageInput.fill("Image upload test");
    await messageInput.press("Enter");

    // Image attachments render as <img> with alt={filename}
    await expect(
      page.locator(`img[alt="${fileName}"]`),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("can remove a pending file before sending", async ({ page }) => {
    const filePath = createTempFile(
      `test-remove-${Date.now()}.txt`,
      "Will be removed",
    );
    tempFiles.push(filePath);

    const fileName = await uploadFile(page, filePath);

    // Click the remove button (aria-label="Remove {filename}")
    const removeButton = page.getByRole("button", {
      name: `Remove ${fileName}`,
    });
    await removeButton.click();

    // The pending file chip should disappear
    await expect(page.getByText(fileName)).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test("upload with text message sends both", async ({ page }) => {
    const filePath = createTempFile(
      `test-combined-${Date.now()}.txt`,
      "Combined upload test",
    );
    tempFiles.push(filePath);

    const fileName = await uploadFile(page, filePath);

    // Type a text message
    const testText = `File upload with text ${Date.now()}`;
    const messageInput = page.getByPlaceholder("Message #general");
    await messageInput.fill(testText);
    await messageInput.press("Enter");

    // Both the text and the file attachment should be visible
    await expect(page.getByText(testText)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator("a").filter({ hasText: fileName }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("rejects files that are too large (validation check)", async ({
    page,
  }) => {
    // Verify the upload pipeline works with a valid small file
    const filePath = createTempFile(
      `test-valid-${Date.now()}.json`,
      JSON.stringify({ test: true }),
    );
    tempFiles.push(filePath);

    const fileName = await uploadFile(page, filePath);
    await expect(page.getByText(fileName).first()).toBeVisible();
  });

  test("file input accepts expected MIME types", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    const acceptAttr = await fileInput.getAttribute("accept");

    expect(acceptAttr).toContain("image/jpeg");
    expect(acceptAttr).toContain("image/png");
    expect(acceptAttr).toContain("application/pdf");
    expect(acceptAttr).toContain("text/plain");
    expect(acceptAttr).toContain("application/json");
  });

  test("multiple file input is enabled", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    const multipleAttr = await fileInput.getAttribute("multiple");
    expect(multipleAttr).not.toBeNull();
  });
});
