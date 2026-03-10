import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
} from "./helpers";
import path from "path";
import fs from "fs";
import os from "os";

test.describe("Section 11: File Uploads", () => {
  let testImagePath: string;
  let testFilePath: string;

  test.beforeAll(() => {
    // Create temporary test files
    const tmpDir = os.tmpdir();

    // Create a minimal PNG image (1x1 red pixel)
    const pngHeader = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52, // IHDR chunk
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01, // 1x1
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x90,
      0x77,
      0x53, // 8-bit RGB
      0xde,
      0x00,
      0x00,
      0x00,
      0x0c,
      0x49,
      0x44,
      0x41, // IDAT chunk
      0x54,
      0x08,
      0xd7,
      0x63,
      0xf8,
      0xcf,
      0xc0,
      0x00, // compressed data
      0x00,
      0x00,
      0x02,
      0x00,
      0x01,
      0xe2,
      0x21,
      0xbc, // ...
      0x33,
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e, // IEND chunk
      0x44,
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
    testImagePath = path.join(tmpDir, "test-upload.png");
    fs.writeFileSync(testImagePath, pngHeader);

    // Create a text file
    testFilePath = path.join(tmpDir, "test-upload.txt");
    fs.writeFileSync(testFilePath, "Test file content for upload testing");
  });

  test.afterAll(() => {
    // Clean up temp files
    try {
      fs.unlinkSync(testImagePath);
      fs.unlinkSync(testFilePath);
    } catch {
      // ignore
    }
  });

  test("upload button visible in message input", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");

    // Look for file upload button (usually a paperclip or + icon)
    const uploadButton = page
      .locator(
        'button[title*="pload"], button[title*="ttach"], button[aria-label*="file"]',
      )
      .or(page.locator('input[type="file"]').locator(".."))
      .or(page.locator("button").filter({ hasText: /📎|attach/i }));

    // At least the file input should exist (may be hidden)
    const fileInput = page.locator('input[type="file"]');
    const hasUpload =
      (await uploadButton
        .first()
        .isVisible()
        .catch(() => false)) || (await fileInput.count()) > 0;
    expect(hasUpload).toBe(true);
  });

  test("upload an image — appears inline", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Upload via the hidden file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testImagePath);

    // Wait for the upload to complete (spinner on upload button disappears)
    const uploadBtn = page.locator('button[title="Upload file"]');
    await expect(uploadBtn.locator(".animate-spin")).not.toBeVisible({
      timeout: 15_000,
    });

    // Send the message with the file attachment
    const msgInput = page.getByPlaceholder("Message #general");
    await msgInput.click();
    await msgInput.press("Enter");

    // Look for the uploaded image by alt text or the filename caption
    await expect(
      page.getByRole("img", { name: "test-upload.png" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("upload non-image file — shows as file card", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);
    await page.waitForTimeout(3_000);

    // Press Enter to send the message with the file
    const msgInput = page.getByPlaceholder("Message #general");
    await msgInput.press("Enter");

    // Should show as a file card with the filename
    await expect(page.getByText(/test-upload\.txt/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("file persists after refresh", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);
    await page.waitForTimeout(3_000);

    // Send the message with the file
    const msgInput = page.getByPlaceholder("Message #general");
    await msgInput.press("Enter");

    // Wait for message to appear
    await expect(page.getByText(/test-upload\.txt/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Refresh page
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectServer(page);
    await openChannel(page, "general");

    // File should still be visible after refresh
    await expect(page.getByText(/test-upload\.txt/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
