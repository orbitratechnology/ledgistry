import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, hasOperator, isMobileViewport, signIn } from "./helpers";

function rowFor(page: Page, payee: string): Locator {
  return isMobileViewport(page)
    ? page.getByTestId("obligation-card").filter({ hasText: payee })
    : page.getByTestId("obligation-row").filter({ hasText: payee });
}

test.describe("obligations", () => {
  test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
  // Writes workspace records: run on one desktop and one phone width.
  test.skip(
    ({ viewport }) => ![1280, 390].includes(viewport?.width ?? 0),
    "Runs on the desktop and mobile projects only",
  );
  test.setTimeout(90_000);

  test("create with validation, edit and archive an obligation", async ({ page }) => {
    const payee = `E2E Freight ${Date.now().toString(36).toUpperCase()}`;
    await signIn(page);
    await page.goto("/obligations");

    await page.getByRole("button", { name: "New obligation" }).first().click();
    const sheet = page.getByRole("dialog", { name: "New obligation" });
    await sheet.getByLabel("Payee").fill(payee);
    await sheet.getByLabel("What it pays for").fill("Ocean freight, October");
    await sheet.getByLabel("Amount").fill("12,34");
    await sheet.getByLabel("Due date").fill("2026-11-30");
    await sheet.getByLabel("Priority").selectOption("critical");
    await sheet.getByRole("button", { name: "Create obligation" }).click();

    // Server-side validation, associated with the field.
    await expect(sheet.getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
    await expect(sheet.getByText("Use commas only as thousands separators")).toBeVisible();

    await sheet.getByLabel("Amount").fill("6,500");
    await sheet.getByRole("button", { name: "Create obligation" }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });

    const row = rowFor(page, payee);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/USD\s6,500\.00/);
    await expect(row).toContainText("Critical");
    await expect(row).toContainText("Planned");
    await expectNoHorizontalOverflow(page);

    // Edit the amount: a material change.
    await row.getByRole("button", { name: `Edit obligation to ${payee}` }).click();
    const edit = page.getByRole("dialog", { name: "Edit obligation" });
    await edit.getByLabel("Amount").fill("7000");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect(rowFor(page, payee)).toContainText(/USD\s7,000\.00/);

    // Archive behind an explicit confirmation.
    await rowFor(page, payee).getByRole("button", { name: "Archive" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive obligation" }).click();
    await expect(rowFor(page, payee)).toHaveCount(0, { timeout: 20_000 });

    await page.getByRole("group", { name: "Which obligations to show" }).getByRole("button", { name: "Archived" }).click();
    await expect(rowFor(page, payee)).toBeVisible({ timeout: 20_000 });

    await page.goto("/activity");
    await expect(page.getByText(`Archived obligation to ${payee}`).filter({ visible: true }).first()).toBeVisible();
  });
});
