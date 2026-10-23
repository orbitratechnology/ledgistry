import { expect, test } from "@playwright/test";

import { hasOperator, signIn } from "./helpers";

const today = () => new Date().toISOString().slice(0, 10);

test.describe("reconciliation (sandbox)", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  // Creates a real simulated deposit in Airwallex Sandbox, so it runs once per suite.
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== 1280, "Runs once, on the desktop project");
  test.setTimeout(180_000);

  test("a partial deposit is suggested, confirmed and keeps its shortfall outstanding", async ({ page }) => {
    const reference = `E2E-${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await page.goto("/reconciliation");

    // 1. Expected receipt (forecast): USD 90.00.
    await page.getByRole("button", { name: "Expected receipt" }).first().click();
    const receiptSheet = page.getByRole("dialog", { name: "New expected receipt" });
    await receiptSheet.getByLabel("Payer").fill("Harbor Retail");
    await receiptSheet.getByLabel("Reference", { exact: true }).fill(reference);
    await receiptSheet.getByLabel("Expected amount").fill("90.00");
    await receiptSheet.getByLabel("Currency").selectOption("USD");
    await receiptSheet.getByLabel("Expected date").fill(today());
    await receiptSheet.getByRole("button", { name: "Add expected receipt" }).click();
    await expect(receiptSheet).toBeHidden({ timeout: 20_000 });

    // 2. Sandbox deposit of USD 45.00 into the USD Global Account, same reference (labelled as a simulation).
    await page.getByRole("button", { name: "Simulate deposit" }).click();
    const simulateSheet = page.getByRole("dialog", { name: "Simulate a sandbox deposit" });
    const accountSelect = simulateSheet.getByLabel("Global Account");
    const usdAccount = await accountSelect.locator("option", { hasText: "receives USD" }).first().getAttribute("value");
    expect(usdAccount, "a USD Global Account in the sandbox").toBeTruthy();
    await accountSelect.selectOption(usdAccount!);
    await simulateSheet.getByLabel(/^Amount/).fill("45.00");
    await simulateSheet.getByLabel("Payer name").fill("Harbor Retail Ltd");
    await simulateSheet.getByLabel("Reference on the transfer").fill(reference);
    await simulateSheet.getByRole("button", { name: "Create sandbox deposit" }).click();
    await expect(simulateSheet).toBeHidden({ timeout: 60_000 });

    // 3. The rules suggest the match and describe the shortfall; nothing is applied yet.
    await page.getByRole("tab", { name: /Review/ }).click();
    // Only the reference-match proposal for this deposit (not a weaker candidate that merely
    // mentions the receipt) carries this explanation.
    const card = page
      .getByTestId("review-card")
      .filter({ hasText: `Reference ${reference} appears on the deposit.` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Reference match", { exact: true })).toBeVisible();
    // A sandbox deposit can still be pending when first listed: the card then says so and cannot be
    // confirmed. Syncing again after settlement re-proposes it with current evidence.
    await expect(async () => {
      if (await card.getByRole("button", { name: "Awaiting settlement" }).count()) {
        await page.getByRole("button", { name: "Sync from Airwallex" }).click();
        await expect(page.getByText(/Synced \d+ deposit/).first()).toBeVisible({ timeout: 30_000 });
      }
      await expect(card.getByText(/^Suggested match/)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    await expect(card.getByText("Sandbox simulation")).toBeVisible();
    const preview = card.getByTestId("apply-preview");
    await expect(preview).toContainText(/USD\s45\.00/);
    await expect(preview).toContainText("will remain outstanding");

    // 4. Explicit confirmation through the dialog.
    await card.getByRole("button", { name: "Confirm match" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(/Apply USD\s45\.00 to/);
    await dialog.getByRole("button", { name: "Confirm match" }).click();
    await expect(page.getByText("Match confirmed").first()).toBeVisible({ timeout: 20_000 });

    // 5. The receipt is partially received, never shown as matched.
    await page.getByRole("tab", { name: /Expected receipts/ }).click();
    const receipt = page.getByTestId(`receipt-card-${reference}`);
    await expect(receipt.getByText("Partially received")).toBeVisible();
    await expect(receipt.getByTestId("receipt-received")).toHaveText("45.00");
    await expect(receipt.getByTestId("receipt-outstanding")).toHaveText("45.00");

    // 6. Re-syncing the same evidence does not duplicate it or re-suggest the decided pair.
    await page.getByRole("button", { name: "Sync from Airwallex" }).click();
    await expect(page.getByText(/\(0 new\)/).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: /Deposits/ }).click();
    await expect(page.getByTestId("deposit-card").filter({ hasText: reference })).toHaveCount(1);
    await expect(page.getByTestId("review-card").filter({ hasText: reference })).toHaveCount(0);

    // 7. The decision is in the audit trail.
    await page.goto("/activity");
    await expect(page.getByText(/Applied USD\s45\.00 from Harbor Retail Ltd to receipt/).filter({ visible: true }).first()).toBeVisible();
  });
});
