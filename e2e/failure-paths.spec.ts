import { expect, test, type Locator, type Page } from "@playwright/test";

import { hasOperator, signIn } from "./helpers";

// Runs against a second server whose Airwallex credentials are invalid and whose AI is switched
// off (see playwright.config.ts). The healthy server shares the database and the session cookie.
const healthy = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3000}`;
const REJECTED = "Airwallex rejected the client ID or API key";

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  expect(value, `option containing "${text}"`).toBeTruthy();
  await select.selectOption(value!);
}

async function archive(page: Page, base: string, payee: string) {
  await page.goto(`${base}/obligations?view=all`);
  const row = page.getByTestId("obligation-row").filter({ hasText: payee });
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive obligation" }).click();
  await expect(row).toHaveCount(0, { timeout: 20_000 });
}

test.describe("failure paths: Airwallex rejects the credentials, AI is off", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  test.setTimeout(240_000);

  test("every screen says what failed, keeps the last real data and offers a retry", async ({ page }) => {
    await signIn(page);

    // 1. Settings names the problem precisely and offers a re-check.
    await page.goto("/settings");
    await expect(page.getByText("Invalid credentials", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(REJECTED)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-check connection" })).toBeVisible();

    // 2. A failed refresh never invents balances: the previous snapshot stays, labelled as such.
    await page.goto("/overview");
    await page.getByRole("button", { name: "Refresh balances" }).first().click();
    await expect(page.getByText(new RegExp(REJECTED)).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("The last refresh failed")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/The balances below are from the previous successful read/)).toBeVisible();

    // 3. A deposit sync fails with the same clear reason.
    await page.goto("/reconciliation");
    await page.getByRole("button", { name: "Sync from Airwallex" }).click();
    await expect(page.getByText(new RegExp(REJECTED)).first()).toBeVisible({ timeout: 30_000 });

    // 4. Without Airwallex the obligation form still works, and says why beneficiaries are missing.
    const payee = `E2E Offline ${Date.now().toString(36).toUpperCase()}`;
    await page.goto("/obligations");
    await page.getByRole("button", { name: "New obligation" }).first().click();
    const sheet = page.getByRole("dialog", { name: "New obligation" });
    await expect(sheet.getByLabel("Airwallex beneficiary")).toBeDisabled({ timeout: 30_000 });
    await expect(sheet.getByText(/Beneficiaries could not be loaded/)).toBeVisible();
    await sheet.getByLabel("Payee").fill(payee);
    await sheet.getByLabel("What it pays for").fill("Failure path check");
    await sheet.getByLabel("Amount").fill("12.00");
    await sheet.getByLabel("Currency").selectOption("USD");
    await sheet.getByLabel("Due date").fill("2026-11-30");
    await sheet.getByRole("button", { name: "Create obligation" }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });

    // 5. The deterministic plan is still calculated; the AI card says it is off, with no retry loop.
    await page.goto("/overview");
    const tab = page.getByRole("tab", { name: /^USD/ });
    if (await tab.count()) await tab.click();
    const plan = page.getByTestId("plan-USD");
    await expect(plan.getByTestId("plan-item").filter({ hasText: payee })).toBeVisible({ timeout: 30_000 });
    const explanation = plan.getByTestId("plan-explanation");
    await expect(explanation).toHaveAttribute("data-status", "failed", { timeout: 30_000 });
    await expect(explanation).toContainText("switched off");
    await expect(explanation).toContainText("The plan is complete without it");
    await expect(explanation.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await archive(page, "", payee);

    // 6. A payment cannot even be reviewed while Airwallex is unreachable, let alone approved.
    const payable = `E2E Blocked ${Date.now().toString(36).toUpperCase()}`;
    await page.goto(`${healthy}/obligations`);
    await page.getByRole("button", { name: "New obligation" }).first().click();
    const healthySheet = page.getByRole("dialog", { name: "New obligation" });
    await healthySheet.getByLabel("Payee").fill(payable);
    await healthySheet.getByLabel("What it pays for").fill("Failure path check");
    await healthySheet.getByLabel("Amount").fill("10.00");
    await healthySheet.getByLabel("Currency").selectOption("EUR");
    await healthySheet.getByLabel("Due date").fill("2026-11-30");
    await healthySheet.getByLabel("Status").selectOption("planned");
    await selectOptionContaining(healthySheet.getByLabel("Airwallex beneficiary"), "DE EUR LOCAL");
    await healthySheet.getByRole("button", { name: "Create obligation" }).click();
    await expect(healthySheet).toBeHidden({ timeout: 20_000 });

    await page.goto("/obligations");
    const row = page.getByTestId("obligation-row").filter({ hasText: payable });
    await row.getByRole("button", { name: `Review payment to ${payable}` }).click();
    const review = page.getByRole("dialog", { name: `Review payment to ${payable}` });
    await expect(review.getByTestId("payment-blocked")).toBeVisible({ timeout: 60_000 });
    await expect(review.getByTestId("approve-and-send")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("payment-operation").filter({ hasText: payable })).toHaveCount(0);
    await archive(page, "", payable);

    // 7. Every failure is in the audit trail.
    await page.goto("/activity");
    for (const label of ["Balance refresh failed", "Deposit sync failed", "Payment review blocked"]) {
      await expect(page.getByText(label, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }

    // 8. The retry path: once Airwallex accepts the credentials, a refresh clears the failure.
    await page.goto(`${healthy}/overview`);
    await page.getByRole("button", { name: "Refresh balances" }).first().click();
    await expect(page.getByText(/Balances refreshed from Airwallex/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("The last refresh failed")).toHaveCount(0);
  });
});
