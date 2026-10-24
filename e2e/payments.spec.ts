import { expect, test, type Locator, type Page } from "@playwright/test";

import { hasOperator, signIn } from "./helpers";

// Test transfers use EUR (large sandbox balance) so the USD demo balance is never touched.

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  expect(value, `option containing "${text}"`).toBeTruthy();
  await select.selectOption(value!);
}

async function createObligation(page: Page, payee: string, currency: string, beneficiary: string) {
  await page.goto("/obligations");
  await page.getByRole("button", { name: "New obligation" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New obligation" });
  await sheet.getByLabel("Payee").fill(payee);
  await sheet.getByLabel("What it pays for").fill("Payment e2e check");
  await sheet.getByLabel("Invoice reference").fill(`INV-${payee.slice(-6)}`);
  await sheet.getByLabel("Amount").fill("25.00");
  await sheet.getByLabel("Currency").selectOption(currency);
  await sheet.getByLabel("Due date").fill("2026-11-20");
  await sheet.getByLabel("Priority").selectOption("high");
  await sheet.getByLabel("Status").selectOption("planned");
  await selectOptionContaining(sheet.getByLabel("Airwallex beneficiary"), beneficiary);
  await sheet.getByRole("button", { name: "Create obligation" }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
}

const row = (page: Page, payee: string) => page.getByTestId("obligation-row").filter({ hasText: payee });

async function openReview(page: Page, payee: string) {
  await row(page, payee).getByRole("button", { name: `Review payment to ${payee}` }).click();
  const review = page.getByRole("dialog", { name: `Review payment to ${payee}` });
  await expect(review.getByTestId("payment-review-details").or(review.getByTestId("payment-blocked")).first()).toBeVisible({
    timeout: 60_000,
  });
  return review;
}

async function archive(page: Page, payee: string) {
  await page.goto("/obligations?view=all");
  const target = row(page, payee);
  if ((await target.count()) === 0) return;
  await target.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive obligation" }).click();
  await expect(target).toHaveCount(0, { timeout: 20_000 });
}

test.describe("guarded payments (sandbox)", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  // Creates real Airwallex Sandbox transfers: desktop project only.
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== 1280, "Runs once, on the desktop project");
  test.setTimeout(240_000);

  test("review, explicit approval, one sandbox transfer, and Completed only once Airwallex says PAID", async ({ page }) => {
    const payee = `E2E Pay ${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await createObligation(page, payee, "EUR", "DE EUR LOCAL");

    // 1. The review shows every material detail, checked live; nothing is sent yet.
    const review = await openReview(page, payee);
    await expect(review.getByText("All checks passed")).toBeVisible();
    await expect(review.getByTestId("review-amount")).toHaveText(/EUR\s25\.00/);
    await expect(review.getByTestId("review-beneficiary")).toContainText("DE EUR LOCAL · EUR");
    await expect(review.getByTestId("review-reference")).toHaveText(/INV-/);
    await expect(review.getByText("Airwallex Sandbox — not real money")).toBeVisible();

    // 2. One explicit approval sends exactly one sandbox transfer.
    await review.getByTestId("approve-and-send").click();
    await expect(page.getByText("Sandbox transfer sent").first()).toBeVisible({ timeout: 90_000 });
    await page.goto("/obligations");
    const operation = page.getByTestId("payment-operation").filter({ hasText: payee });
    await expect(operation).toHaveCount(1);
    await expect(operation.getByTestId("provider-status")).toContainText(/Airwallex: (SCHEDULED|PROCESSING|SENT|PAID)/);
    await expect(operation).toContainText(/request ledgistry-[0-9a-f]{32}/);
    if ((await operation.getAttribute("data-status")) !== "completed") {
      await expect(operation).not.toContainText("Completed");

      // 3. Sandbox: Airwallex itself moves the transfer to PAID; Ledgistry reads it back.
      // Exact match: the PAID status note on earlier payments contains the same words in lower case.
      await operation.getByRole("button", { name: "Sandbox: simulate paid" }).click();
      await expect(page.getByText("Airwallex reports the transfer as PAID.", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
    }
    await expect(operation).toHaveAttribute("data-status", "completed", { timeout: 30_000 });
    await expect(operation.getByTestId("provider-status")).toHaveText("Airwallex: PAID");

    // 4. The obligation is paid and the chain is in the audit trail.
    await page.goto("/obligations?view=all");
    await expect(row(page, payee)).toContainText("Paid");
    await page.goto("/activity");
    await expect(page.getByText(new RegExp(`Approved EUR\\s25\\.00 to ${payee}`)).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`EUR\\s25\\.00 to ${payee}: completed, Airwallex status PAID`)).filter({ visible: true }).first()).toBeVisible();

    await archive(page, payee);
  });

  test("a review goes stale when the obligation changes, and cannot be approved", async ({ page, context }) => {
    const payee = `E2E Stale ${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await createObligation(page, payee, "EUR", "DE EUR LOCAL");
    const review = await openReview(page, payee);
    await expect(review.getByText("All checks passed")).toBeVisible();

    // Someone changes the amount in another tab after the review was opened.
    const other = await context.newPage();
    await other.goto("/obligations");
    await row(other, payee).getByRole("button", { name: `Edit obligation to ${payee}` }).click();
    const edit = other.getByRole("dialog", { name: "Edit obligation" });
    await edit.getByLabel("Amount").fill("26.00");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await other.close();

    await review.getByTestId("approve-and-send").click();
    await expect(page.getByText("Not sent").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/already invalidated|changed/i).first()).toBeVisible();
    await page.goto("/obligations");
    await expect(page.getByTestId("payment-operation").filter({ hasText: payee })).toHaveCount(0);

    await archive(page, payee);
  });

  test("a beneficiary in another currency blocks approval instead of assuming FX", async ({ page }) => {
    const payee = `E2E FX ${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await createObligation(page, payee, "GBP", "DE EUR LOCAL");
    const review = await openReview(page, payee);
    await expect(review.getByTestId("payment-blocked")).toContainText("No FX conversion is assumed");
    await expect(review.getByTestId("approve-and-send")).toBeDisabled();
    await page.keyboard.press("Escape");
    await archive(page, payee);
  });
});
