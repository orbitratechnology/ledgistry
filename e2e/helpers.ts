import { expect, type Page } from "@playwright/test";

export const operator = {
  email: process.env.E2E_OPERATOR_EMAIL ?? "",
  password: process.env.E2E_OPERATOR_PASSWORD ?? "",
};

export const hasOperator = Boolean(operator.email && operator.password);

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(operator.email);
  await page.getByLabel("Password").fill(operator.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/overview");
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page-level horizontal overflow (px)").toBeLessThanOrEqual(0);
}

export function isMobileViewport(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}
