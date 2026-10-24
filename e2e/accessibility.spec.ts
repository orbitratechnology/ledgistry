import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { hasOperator, isMobileViewport, signIn } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Runs axe on the page (or one region) and fails with a readable list of violations. */
async function expectNoViolations(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const summary = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n    ${violation.nodes
        .slice(0, 5)
        .map((node) => node.target.join(" "))
        .join("\n    ")}`,
  );
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test.setTimeout(120_000);

  test("sign-in page", async ({ page }) => {
    await page.goto("/login");
    await expectNoViolations(page, "/login");
  });

  test.describe("signed in", () => {
    test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");

    test("every workspace page", async ({ page }) => {
      await signIn(page);
      for (const path of ["/overview", "/reconciliation", "/obligations", "/activity", "/settings"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("[aria-busy='true']")).toHaveCount(0, { timeout: 30_000 });
        await expectNoViolations(page, path);
      }
    });

    test("reconciliation tabs", async ({ page }) => {
      await signIn(page);
      await page.goto("/reconciliation");
      for (const tab of [/Review/, /Deposits/, /Expected receipts/]) {
        await page.getByRole("tab", { name: tab }).click();
        await page.waitForLoadState("networkidle");
        await expectNoViolations(page, `/reconciliation ${tab}`);
      }
    });

    test("forms in sheets and the mobile navigation", async ({ page }) => {
      await signIn(page);
      await page.goto("/obligations");
      await page.getByRole("button", { name: "New obligation" }).first().click();
      const sheet = page.getByRole("dialog", { name: "New obligation" });
      await expect(sheet).toBeVisible();
      // Submitting empty shows the validation messages, which must be tied to their fields.
      await sheet.getByRole("button", { name: "Create obligation" }).click();
      await expect(sheet.getByLabel("Payee")).toHaveAttribute("aria-invalid", "true", { timeout: 10_000 });
      await expectNoViolations(page, "new obligation sheet", "[role='dialog']");
      await page.keyboard.press("Escape");

      await page.goto("/reconciliation");
      await page.getByRole("button", { name: "Expected receipt" }).first().click();
      await expect(page.getByRole("dialog", { name: "New expected receipt" })).toBeVisible();
      await expectNoViolations(page, "new expected receipt sheet", "[role='dialog']");
      await page.keyboard.press("Escape");

      if (isMobileViewport(page)) {
        await page.getByRole("button", { name: "Toggle navigation" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expectNoViolations(page, "mobile navigation drawer", "[role='dialog']");
      }
    });

    test("keyboard: skip link, sheet focus and Escape", async ({ page }) => {
      test.skip(isMobileViewport(page), "Keyboard flow is checked on larger screens");
      await signIn(page);
      await page.goto("/obligations");
      await page.waitForLoadState("networkidle");

      // The first Tab stop skips the navigation straight to the page content.
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to main content" });
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main-content")).toBeFocused();

      // A sheet opened from the keyboard takes focus, closes on Escape and returns focus.
      const trigger = page.getByRole("button", { name: "New obligation" }).first();
      await trigger.focus();
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: "New obligation" });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator(":focus")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
});
