import { expect, test, type Locator, type Page } from "@playwright/test";

import { hasOperator, signIn } from "./helpers";

/** Selects the first option whose label contains `text` (labels carry ids/currencies). */
async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  expect(value, `option containing "${text}"`).toBeTruthy();
  await select.selectOption(value!);
}

/** "USD 9,999,935.00" → 999993500n (cents). */
const toCents = (text: string) => BigInt(text.replace(/[^\d]/g, ""));
const centsToInput = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
/** 999983500n → "9,999,835.00", as the app displays it. */
const centsDisplay = (cents: bigint) => `${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;

async function usdPlan(page: Page) {
  await page.goto("/overview");
  const tab = page.getByRole("tab", { name: /^USD/ });
  if (await tab.count()) await tab.click();
  const plan = page.getByTestId("plan-USD");
  await expect(plan).toBeVisible({ timeout: 30_000 });
  return plan;
}

async function createObligation(page: Page, payee: string, amount: string, priority: string) {
  await page.goto("/obligations");
  await page.getByRole("button", { name: "New obligation" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New obligation" });
  await sheet.getByLabel("Payee").fill(payee);
  await sheet.getByLabel("What it pays for").fill("Planner e2e check");
  await sheet.getByLabel("Amount").fill(amount);
  await sheet.getByLabel("Currency").selectOption("USD");
  await sheet.getByLabel("Due date").fill("2026-11-15");
  await sheet.getByLabel("Priority").selectOption(priority);
  await sheet.getByLabel("Status").selectOption("planned");
  await selectOptionContaining(sheet.getByLabel("Airwallex beneficiary"), "USD LOCAL");
  await sheet.getByRole("button", { name: "Create obligation" }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
}

async function archiveObligation(page: Page, payee: string) {
  await page.goto("/obligations");
  const row = page.getByTestId("obligation-row").filter({ hasText: payee });
  await row.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive obligation" }).click();
  await expect(row).toHaveCount(0, { timeout: 20_000 });
}

test.describe("cash planning", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  // Writes reserves and obligations against the real sandbox balance: desktop project only.
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== 1280, "Runs once, on the desktop project");
  test.setTimeout(180_000);

  test("the reserve decides what is recommended and what is deferred, with reasons and versions", async ({ page }) => {
    const id = Date.now().toString(36).toUpperCase();
    const critical = `E2E Plan Critical ${id}`;
    const low = `E2E Plan Low ${id}`;
    await signIn(page);

    // 1. Fresh actual balance; the plan is recalculated from it.
    await page.getByRole("button", { name: "Refresh balances" }).first().click();
    await expect(page.getByText(/Balances refreshed from Airwallex/).first()).toBeVisible({ timeout: 30_000 });
    let plan = await usdPlan(page);
    const available = toCents(await plan.getByTestId("plan-available").innerText());
    expect(available).toBeGreaterThan(20_000n);

    // 2. Protect everything except USD 100.00 of the real balance.
    await page.goto("/settings");
    const reserves = page.getByTestId("reserves-card");
    const existing = reserves.getByTestId("reserve-USD");
    const editing = (await existing.count()) > 0;
    if (editing) {
      await existing.getByRole("button", { name: "Edit USD reserve" }).click();
    } else {
      await reserves.getByRole("button", { name: "Add reserve" }).click();
    }
    const sheet = page.getByRole("dialog", { name: editing ? "Edit USD reserve" : "Set a protected reserve" });
    if (!editing) await sheet.getByLabel("Currency").selectOption("USD");
    await sheet.getByLabel(/reserve/i).fill(centsToInput(available - 10_000n));
    await sheet.getByRole("button", { name: /reserve/i }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    const reserveRow = page.getByTestId("reserve-USD");
    const reserveText = centsDisplay(available - 10_000n);
    await expect(reserveRow).toContainText(reserveText);
    if (await reserveRow.getByRole("button", { name: "Turn on" }).count()) {
      await reserveRow.getByRole("button", { name: "Turn on" }).click();
      await expect(reserveRow.getByText("Protected")).toBeVisible({ timeout: 20_000 });
    }

    // 3. Two payable obligations: USD 60 critical fits, USD 50 low does not (USD 40 headroom left).
    await createObligation(page, critical, "60.00", "critical");
    await createObligation(page, low, "50.00", "low");

    // 4. The plan ranks them, keeps the reserve and explains each decision from its facts.
    plan = await usdPlan(page);
    const recommended = plan.getByTestId("plan-section-recommended").getByTestId("plan-item").filter({ hasText: critical });
    await expect(recommended).toBeVisible();
    await expect(recommended.getByTestId("plan-reason")).toContainText(/USD\s40\.00 above your USD/);
    const deferred = plan.getByTestId("plan-section-deferred").getByTestId("plan-item").filter({ hasText: low });
    await expect(deferred).toBeVisible();
    await expect(deferred.getByTestId("plan-reason")).toContainText("below your USD");
    await expect(plan.getByTestId("plan-reserve")).toContainText(reserveText);
    await expect(plan.getByTestId("plan-spendable")).toHaveText(/USD\s100\.00/);

    // 5. Immutable versions: the latest one says what changed since the previous version.
    await expect(plan.getByTestId("plan-changes")).toContainText(`${low}`);
    await expect(plan.getByTestId("plan-changes")).toContainText("Deferred");

    // 6. The AI card is present and either grounded or honestly unavailable; the plan never depends on it.
    const explanation = plan.getByTestId("plan-explanation");
    await expect(explanation).toBeVisible({ timeout: 45_000 });
    await expect(explanation).toHaveAttribute("data-status", /ready|failed/);

    // 7. The trail records plan versions and the reserve change.
    await page.goto("/activity");
    await expect(page.getByText("Cash plan calculated").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Reserve (set|changed)/).filter({ visible: true }).first()).toBeVisible();

    // 8. Clean up the records this test created.
    await archiveObligation(page, critical);
    await archiveObligation(page, low);
  });

  test("AI pre-fills an expected receipt from pasted text, and nothing is saved until you submit", async ({ page }) => {
    const reference = `INV-E2E-${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await page.goto("/reconciliation");
    await page.getByRole("button", { name: "Expected receipt" }).first().click();
    const sheet = page.getByRole("dialog", { name: "New expected receipt" });
    await sheet
      .getByLabel(/Fill from pasted text/)
      .fill(`Hello, Harbor Retail Ltd will pay US$ 4,500.00 against invoice ${reference} on 30 Oct 2026. Thanks!`);
    await sheet.getByRole("button", { name: "Fill form with AI" }).click();
    await expect(sheet.getByTestId("ai-prefill-notice")).toBeVisible({ timeout: 45_000 });
    await expect(sheet.getByLabel("Reference", { exact: true })).toHaveValue(reference);
    await expect(sheet.getByLabel("Expected amount")).toHaveValue("4500.00");
    await expect(sheet.getByLabel("Currency")).toHaveValue("USD");
    await expect(sheet.getByLabel("Expected date")).toHaveValue("2026-10-30");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByRole("tab", { name: /Expected receipts/ }).click();
    await expect(page.getByTestId(`receipt-card-${reference}`)).toHaveCount(0);
  });
});
