import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, hasOperator, isMobileViewport, signIn } from "./helpers";

test.describe("workspace", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("refreshes real balances from Airwallex Sandbox", async ({ page }) => {
    await page.getByRole("button", { name: /Refresh balances|Fetch balances from Airwallex/ }).first().click();
    await expect(page.getByText("Balances refreshed", { exact: true })).toBeVisible({ timeout: 30_000 });

    const usd = page.getByTestId("balance-card-USD");
    await expect(usd).toBeVisible();
    await expect(usd.getByText("Actual")).toBeVisible();
    await expect(usd.getByText("Available now")).toBeVisible();
    await expect(page.getByText(/Updated/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("core pages render without page-level horizontal overflow", async ({ page }) => {
    for (const [path, heading] of [
      ["/overview", "Cash position"],
      ["/reconciliation", "Reconciliation"],
      ["/obligations", "Obligations"],
      ["/activity", "Activity"],
      ["/settings", "Settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    }
  });

  test("settings reports a live, truthful Airwallex connection", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("https://api.sandbox.airwallex.com")).toBeVisible();
    await expect(page.getByText("Sandbox-only guard")).toBeVisible();
  });

  test("navigation works with the sidebar (drawer on mobile)", async ({ page }) => {
    if (isMobileViewport(page)) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    }
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { level: 2, name: "Activity" })).toBeVisible();
    // The timeline renders as cards on mobile and a table from md up; check whichever is shown.
    await expect(page.getByText("Signed in").filter({ visible: true }).first()).toBeVisible();
  });
});
