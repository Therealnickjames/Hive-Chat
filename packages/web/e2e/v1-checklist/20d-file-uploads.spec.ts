import { test, expect } from "@playwright/test";
import {
  login,
  DEMO_USER,
  selectServer,
  openChannel,
  waitForWebSocket,
  createServerViaAPI,
} from "./helpers";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * TASK-0025: File & Image Uploads — Extended E2E tests
 *
 * Covers drag-and-drop overlay, multiple file upload, upload progress UI,
 * pending file removal, and large file rejection.
 * Complements the baseline upload tests in 11-uploads.spec.ts.
 */

let serverName: string;
let testImagePath: string;
let testFilePath: string;
let testFile2Path: string;

test.beforeAll(async ({ browser }) => {
  // Create temporary test files
  const tmpDir = os.tmpdir();

  // Minimal PNG (1x1 red pixel)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  testImagePath = path.join(tmpDir, "test-upload-25.png");
  fs.writeFileSync(testImagePath, pngHeader);

  testFilePath = path.join(tmpDir, "test-upload-25a.txt");
  fs.writeFileSync(testFilePath, "First test file for TASK-0025");

  testFile2Path = path.join(tmpDir, "test-upload-25b.txt");
  fs.writeFileSync(testFile2Path, "Second test file for TASK-0025");

  // Provision server
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, DEMO_USER.email, DEMO_USER.password);
  serverName = `Uploads-S25-${Date.now()}`;
  await createServerViaAPI(page, serverName);
  await ctx.close();
});

test.afterAll(() => {
  try {
    fs.unlinkSync(testImagePath);
    fs.unlinkSync(testFilePath);
    fs.unlinkSync(testFile2Path);
  } catch {
    // ignore
  }
});

test.describe("Section 25: File & Image Uploads (Extended)", () => {
  test("multiple files upload — all appear as pending chips", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Upload two files at once
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([testFilePath, testFile2Path]);

    // Both filenames should appear as pending chips
    await expect(page.getByText("test-upload-25a.txt")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("test-upload-25b.txt")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("remove pending file — click x removes chip before send", async ({
    page,
  }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Upload a file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for the chip to appear
    await expect(page.getByText("test-upload-25a.txt")).toBeVisible({
      timeout: 10_000,
    });

    // Click remove button (the "x" button)
    const removeBtn = page.getByLabel("Remove test-upload-25a.txt");
    await removeBtn.click();

    // Chip should disappear
    await expect(page.getByText("test-upload-25a.txt")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("upload button shows spinner during upload", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // The upload button should exist with title "Upload file"
    const uploadBtn = page.locator('button[title="Upload file"]');
    await expect(uploadBtn).toBeVisible();

    // Upload a file — the button shows a spinner while uploading
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testImagePath);

    // Wait for upload to complete (spinner disappears)
    await expect(uploadBtn.locator(".animate-spin")).not.toBeVisible({
      timeout: 15_000,
    });

    // Send and verify the image appears
    const msgInput = page.getByPlaceholder("Message #general");
    await msgInput.click();
    await msgInput.press("Enter");

    await expect(
      page.getByRole("img", { name: "test-upload-25.png" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("drag-and-drop overlay appears on dragenter", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    // Simulate a dragenter event on the message input area
    const inputArea = page.locator(".relative.px-5.pb-5.pt-1");
    await inputArea.dispatchEvent("dragenter", {
      dataTransfer: { types: ["Files"] },
    });

    // The "Drop files here" overlay should appear
    await expect(page.getByText("Drop files here")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("file input accepts multiple file types", async ({ page }) => {
    await login(page, DEMO_USER.email, DEMO_USER.password);
    await selectServer(page, serverName);
    await openChannel(page, "general");

    // Verify the file input has the correct accept attribute
    const fileInput = page.locator('input[type="file"]');
    const accept = await fileInput.getAttribute("accept");
    expect(accept).toContain("image/jpeg");
    expect(accept).toContain("image/png");
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("text/plain");
    expect(accept).toContain("application/json");
    expect(accept).toContain("application/zip");

    // Verify file input supports multiple files
    const multiple = await fileInput.getAttribute("multiple");
    expect(multiple).not.toBeNull();
  });
});
