import { expect, test, type Page } from "@playwright/test";

import { hasOperator, signIn } from "./helpers";

async function demoAction(page: Page, name: string, confirm = false) {
  await page.getByTestId("demo-card").getByRole("button", { name }).click();
  if (confirm) await page.getByRole("alertdialog").getByRole("button", { name }).click();
}

test.describe("demo data", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  // Writes sample records and the USD reserve in the e2e workspace: desktop project only.
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== 1280, "Runs once, on the desktop project");
  test.setTimeout(180_000);

  test("loads idempotently, labels every sample record, resets and removes without touching Airwallex", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Refresh balances" }).first().click();
    await expect(page.getByText(/Balances refreshed from Airwallex/).first()).toBeVisible({ timeout: 30_000 });

    // 1. Load; a second load changes nothing.
    await page.goto("/settings");
    const card = page.getByTestId("demo-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    if (await card.getByRole("button", { name: "Remove demo data" }).count()) {
      await demoAction(page, "Remove demo data", true);
      await expect(page.getByText(/^Demo data removed:/).first()).toBeVisible({ timeout: 30_000 });
    }
    await demoAction(page, "Load demo data");
    await expect(page.getByText(/^Loaded demo data: created 2 sample obligations and 1 sample expected receipt/).first()).toBeVisible({
      timeout: 30_000,
    });
    await demoAction(page, "Load demo data");
    await expect(page.getByText("Demo data is already loaded; nothing changed.").first()).toBeVisible({ timeout: 30_000 });

    // 2. Readiness reflects live provider facts and the workspace.
    for (const id of ["connection", "global-account", "beneficiary", "reserve", "records"]) {
      await expect(card.getByTestId(`demo-check-${id}`)).toHaveAttribute("data-state", "ready");
    }
    const balanceReady = (await card.getByTestId("demo-check-balance").getAttribute("data-state")) === "ready";
    await expect(card).toContainText("Reconciliation starts");

    // 3. Every sample record is labelled; the plan follows the scenario when the balance matches it.
    await page.goto("/obligations");
    for (const payee of ["Pacific Freight Co.", "Brightline Packaging Ltd"]) {
      await expect(page.getByTestId("obligation-row").filter({ hasText: payee })).toContainText("Demo record");
    }
    await page.goto("/reconciliation");
    await page.getByRole("tab", { name: /Expected receipts/ }).click();
    await expect(page.getByTestId("receipt-card-HR-INV-2041")).toContainText("Demo record");
    if (balanceReady) {
      await page.goto("/overview");
      const tab = page.getByRole("tab", { name: /^USD/ });
      if (await tab.count()) await tab.click();
      const plan = page.getByTestId("plan-USD");
      await expect(plan.getByTestId("plan-section-recommended").getByTestId("plan-item").filter({ hasText: "Pacific Freight Co." })).toBeVisible({
        timeout: 30_000,
      });
      await expect(plan.getByTestId("plan-section-deferred").getByTestId("plan-item").filter({ hasText: "Brightline Packaging Ltd" })).toBeVisible();
    }

    // 4. Reset archives and reloads; remove archives. Both are in the audit trail.
    await page.goto("/settings");
    await demoAction(page, "Reset demo data", true);
    await expect(page.getByText(/^Reloaded demo data: created 2 sample obligations/).first()).toBeVisible({ timeout: 30_000 });
    await demoAction(page, "Remove demo data", true);
    await expect(page.getByText(/^Demo data removed: archived 2 sample obligations and 1 sample expected receipt/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByTestId("demo-check-records")).toHaveAttribute("data-state", "missing");
    await page.goto("/obligations");
    await expect(page.getByTestId("obligation-row").filter({ hasText: "Pacific Freight Co." })).toHaveCount(0);

    await page.goto("/activity");
    for (const label of ["Demo data loaded", "Demo data reset", "Demo data removed"]) {
      await expect(page.getByText(label, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
    await expect(
      page.getByText(/Airwallex balances and transfers were not changed\./).filter({ visible: true }).first(),
    ).toBeVisible();
  });
});
