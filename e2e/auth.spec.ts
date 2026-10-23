import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, hasOperator, isMobileViewport, signIn } from "./helpers";

test.describe("authentication", () => {
  for (const path of ["/", "/overview", "/settings", "/activity"]) {
    test(`redirects signed-out visitors from ${path} to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  }

  test("login page fits the viewport", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
  });

  test("validates the email on the server and associates the error with the field", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#email-error")).toHaveText("Enter a valid email address.");
  });

  test("rejects wrong credentials with a generic message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@ledgistry.test");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs in and signs out", async ({ page }) => {
    test.skip(!hasOperator, "E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD not set");
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Cash position" })).toBeVisible();

    if (isMobileViewport(page)) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    }
    await page.getByRole("button", { name: /My workspace/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is gone: workspace routes redirect again.
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login$/);
  });
});
