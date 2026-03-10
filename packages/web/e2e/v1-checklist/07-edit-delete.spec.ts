import { test, expect } from "@playwright/test";
import {
  login,
  ALICE,
  BOB,
  selectServer,
  openChannel,
  waitForWebSocket,
  sendMessage,
  uniqueMsg,
  createTwoUserContexts,
  cleanupContexts,
} from "./helpers";

test.describe("Section 7: Message Edit & Delete", () => {
  test("send message, edit it — updated text appears with (edited)", async ({
    page,
  }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const original = uniqueMsg("Edit-original");
    await sendMessage(page, "general", original);

    // Hover over the message to reveal action buttons
    const msgContainer = page
      .locator("div.group")
      .filter({ hasText: original })
      .first();
    await msgContainer.hover();

    // Click edit button (title="Edit message")
    await msgContainer
      .locator('button[title="Edit message"]')
      .click({ force: true, timeout: 5_000 });

    // The editing area should appear with a textbox
    const editInput = msgContainer.getByRole("textbox").first();
    await expect(editInput).toBeVisible({ timeout: 5_000 });

    const updated = uniqueMsg("Edit-updated");
    await editInput.fill(updated);

    // Click Save button (more reliable than Enter key)
    await page.getByRole("button", { name: "Save" }).click();

    // Updated text should appear
    await expect(page.getByText(updated)).toBeVisible({ timeout: 10_000 });

    // "(edited)" indicator should show
    await expect(
      page
        .locator("span")
        .filter({ hasText: /edited/i })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("other user sees edit in real time", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const original = uniqueMsg("RT-edit-orig");
      await sendMessage(pageA, "general", original);
      await expect(pageB.getByText(original)).toBeVisible({ timeout: 15_000 });

      // Alice edits
      const msgContainer = pageA
        .locator("div.group")
        .filter({ hasText: original })
        .first();
      await msgContainer.hover();
      await msgContainer
        .locator('button[title="Edit message"]')
        .click({ force: true });

      const updated = uniqueMsg("RT-edit-updated");
      const editInput = msgContainer.getByRole("textbox").first();
      await editInput.fill(updated);
      await pageA.getByRole("button", { name: "Save" }).click();

      // Bob should see the update
      await expect(pageB.getByText(updated)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("delete a message — disappears", async ({ page }) => {
    await login(page, ALICE.email, ALICE.password);
    await selectServer(page);
    await openChannel(page, "general");
    await waitForWebSocket(page, "general");

    const msg = uniqueMsg("Delete-me");
    await sendMessage(page, "general", msg);
    await page.waitForTimeout(500);

    // Find the message container and trigger delete via dispatchEvent
    // (force:true clicks at wrong coordinates on hidden elements)
    const msgContainer = page
      .locator("div.group")
      .filter({ hasText: msg })
      .first();
    await msgContainer
      .locator('button[title="Delete message"]')
      .dispatchEvent("click");

    // Verify the confirmation modal appears with the correct message
    await expect(page.getByText("Are you sure you want to delete")).toBeVisible(
      { timeout: 5_000 },
    );
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Wait for modal to close (confirms delete succeeded)
    await expect(
      page.getByText("Are you sure you want to delete"),
    ).not.toBeVisible({ timeout: 10_000 });

    // Original text should be replaced with [message deleted] (soft-delete)
    await expect(page.getByText(msg)).not.toBeVisible({ timeout: 10_000 });
  });

  test("other user sees deletion in real time", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const msg = uniqueMsg("RT-delete");
      await sendMessage(pageA, "general", msg);
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      // Alice deletes — use dispatchEvent to avoid force:true coordinate issues
      const msgContainer = pageA
        .locator("div.group")
        .filter({ hasText: msg })
        .first();
      await msgContainer
        .locator('button[title="Delete message"]')
        .dispatchEvent("click");

      // Confirm deletion in the modal
      await expect(
        pageA.getByText("Are you sure you want to delete"),
      ).toBeVisible({ timeout: 5_000 });
      await pageA.getByRole("button", { name: "Delete", exact: true }).click();

      // Wait for modal to close
      await expect(
        pageA.getByText("Are you sure you want to delete"),
      ).not.toBeVisible({ timeout: 10_000 });

      // Bob should see it disappear (soft-deleted)
      await expect(pageB.getByText(msg)).not.toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("cannot edit another user's message", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const msg = uniqueMsg("No-edit");
      await sendMessage(pageA, "general", msg);
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      // Bob tries to find edit button on Alice's message
      const msgContainer = pageB
        .locator("div.group")
        .filter({ hasText: msg })
        .first();
      await msgContainer.hover();

      // Edit button should NOT be visible for other user's message
      const editButton = msgContainer.locator('button[title="Edit message"]');
      await expect(editButton).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });

  test("cannot delete another user's message", async ({ browser }) => {
    const { contextA, contextB, pageA, pageB } = await createTwoUserContexts(
      browser,
      ALICE,
      BOB,
    );

    try {
      await selectServer(pageA);
      await selectServer(pageB);
      await openChannel(pageA, "general");
      await openChannel(pageB, "general");
      await waitForWebSocket(pageA, "general");
      await waitForWebSocket(pageB, "general");

      const msg = uniqueMsg("No-delete");
      await sendMessage(pageA, "general", msg);
      await expect(pageB.getByText(msg)).toBeVisible({ timeout: 15_000 });

      // Bob tries to find delete button on Alice's message
      const msgContainer = pageB
        .locator("div.group")
        .filter({ hasText: msg })
        .first();
      await msgContainer.hover();

      // Delete button should NOT be visible for other user's message
      const deleteButton = msgContainer.locator(
        'button[title="Delete message"]',
      );
      await expect(deleteButton).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await cleanupContexts(contextA, contextB);
    }
  });
});
